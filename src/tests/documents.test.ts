import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import fs from "fs/promises";
import path from "path";
import { createApp } from "../app";
import { prisma, disconnectDatabase } from "../config/prisma";
import { authService } from "../modules/auth/auth.service";

/**
 * Creates a valid single-page PDF buffer containing extractable text.
 */
function createSamplePdfBuffer(text: string): Buffer {
  const contentStream = `BT /F1 12 Tf 72 712 Td (${text}) Tj ET`;
  const streamLength = Buffer.byteLength(contentStream);

  const pdfString = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /MediaBox [0 0 612 792] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length ${streamLength} >>
stream
${contentStream}
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000261 00000 n 
trailer
<< /Size 5 /Root 1 0 R >>
startxref
${360 + streamLength}
%%EOF`;

  return Buffer.from(pdfString);
}

/**
 * Creates a valid PDF structure without extractable text (e.g. empty or scanned).
 */
function createEmptyPdfBuffer(): Buffer {
  const contentStream = "";
  const streamLength = 0;

  const pdfString = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Resources <<>> /MediaBox [0 0 612 792] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length ${streamLength} >>
stream
${contentStream}
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000200 00000 n 
trailer
<< /Size 5 /Root 1 0 R >>
startxref
250
%%EOF`;

  return Buffer.from(pdfString);
}

describe("Phase 4: Document Storage, Processing, pgvector & QA Integration", () => {
  const app = createApp();
  const testRunId = Date.now();

  let userAId = "";
  let userAToken = "";
  let userBId = "";
  let userBToken = "";
  let uploadedDocId = "";

  beforeAll(async () => {
    // 1. Create User A
    const sessionA = await authService.register({
      email: `docs.user.a.${testRunId}@example.com`,
      password: "Password123!",
      displayName: "Document Student A",
    });
    userAId = sessionA.user.id;
    userAToken = sessionA.token;

    // 2. Create User B (for cross-user isolation verification)
    const sessionB = await authService.register({
      email: `docs.user.b.${testRunId}@example.com`,
      password: "Password123!",
      displayName: "Document Student B",
    });
    userBId = sessionB.user.id;
    userBToken = sessionB.token;
  });

  afterAll(async () => {
    try {
      if (userAId) {
        await prisma.user.delete({ where: { id: userAId } }).catch(() => {});
      }
      if (userBId) {
        await prisma.user.delete({ where: { id: userBId } }).catch(() => {});
      }
    } finally {
      await disconnectDatabase();
    }
  });

  // --------------------------------------------------------------------------
  // 1. Document Upload & Processing Pipeline
  // --------------------------------------------------------------------------
  describe("POST /api/v1/documents", () => {
    it("successfully uploads a supported PDF and processes it to READY state", async () => {
      const sampleText =
        "Photosynthesis is the biological process used by plants to convert solar light energy into chemical glucose.";
      const pdfBuffer = createSamplePdfBuffer(sampleText);

      const res = await request(app)
        .post("/api/v1/documents")
        .set("Authorization", `Bearer ${userAToken}`)
        .attach("file", pdfBuffer, "photosynthesis_guide.pdf");

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("id");
      expect(res.body.originalName).toBe("photosynthesis_guide.pdf");
      expect(res.body.mimeType).toBe("application/pdf");
      expect(typeof res.body.sizeBytes).toBe("number");
      expect(res.body.status).toBe("READY");
      expect(res.body.pageCount).toBe(1);

      uploadedDocId = res.body.id;

      // Verify that chunks and pgvector embeddings were persisted in DB
      const chunkCount = await prisma.documentChunk.count({
        where: { documentId: uploadedDocId },
      });
      expect(chunkCount).toBeGreaterThanOrEqual(1);
    });

    it("rejects non-PDF mime types", async () => {
      const res = await request(app)
        .post("/api/v1/documents")
        .set("Authorization", `Bearer ${userAToken}`)
        .attach("file", Buffer.from("Not a real PDF"), {
          filename: "test.txt",
          contentType: "text/plain",
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("BAD_REQUEST");
      expect(res.body.error.message).toContain("only PDF documents");
    });

    it("rejects corrupted magic bytes file masquerading as PDF", async () => {
      const fakePdfBuffer = Buffer.from("NOT_A_REAL_PDF_HEADER_JUST_RANDOM_TEXT_DATA");

      const res = await request(app)
        .post("/api/v1/documents")
        .set("Authorization", `Bearer ${userAToken}`)
        .attach("file", fakePdfBuffer, {
          filename: "fake.pdf",
          contentType: "application/pdf",
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("BAD_REQUEST");
      expect(res.body.error.message).toContain("signature");
    });

    it("detects empty/scanned PDF and marks status as FAILED with SCANNED_OR_EMPTY_PDF", async () => {
      const emptyPdfBuffer = createEmptyPdfBuffer();

      const res = await request(app)
        .post("/api/v1/documents")
        .set("Authorization", `Bearer ${userAToken}`)
        .attach("file", emptyPdfBuffer, "empty_scan.pdf");

      expect(res.status).toBe(201);
      expect(res.body.status).toBe("FAILED");
      expect(res.body.errorCode).toBe("SCANNED_OR_EMPTY_PDF");
    });

    it("rejects unauthenticated upload requests with 401", async () => {
      const pdfBuffer = createSamplePdfBuffer("Simple text");

      const res = await request(app)
        .post("/api/v1/documents")
        .attach("file", pdfBuffer, "unauth.pdf");

      expect(res.status).toBe(401);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Listing & Retrieving Documents
  // --------------------------------------------------------------------------
  describe("GET /api/v1/documents & GET /api/v1/documents/:id", () => {
    it("lists only User A's uploaded documents", async () => {
      const res = await request(app)
        .get("/api/v1/documents")
        .set("Authorization", `Bearer ${userAToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("documents");
      expect(Array.isArray(res.body.documents)).toBe(true);
      const found = res.body.documents.find((d: { id: string }) => d.id === uploadedDocId);
      expect(found).toBeDefined();
    });

    it("returns empty document list for User B (cross-user isolation)", async () => {
      const res = await request(app)
        .get("/api/v1/documents")
        .set("Authorization", `Bearer ${userBToken}`);

      expect(res.status).toBe(200);
      const found = res.body.documents.find((d: { id: string }) => d.id === uploadedDocId);
      expect(found).toBeUndefined();
    });

    it("retrieves document details for owner User A", async () => {
      const res = await request(app)
        .get(`/api/v1/documents/${uploadedDocId}`)
        .set("Authorization", `Bearer ${userAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(uploadedDocId);
      expect(res.body.status).toBe("READY");
    });

    it("rejects User B from retrieving User A's document with 404", async () => {
      const res = await request(app)
        .get(`/api/v1/documents/${uploadedDocId}`)
        .set("Authorization", `Bearer ${userBToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("rejects invalid document ID format with 400", async () => {
      const res = await request(app)
        .get("/api/v1/documents/not-a-valid-uuid")
        .set("Authorization", `Bearer ${userAToken}`);

      expect(res.status).toBe(400);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Grounded Question Answering (RAG)
  // --------------------------------------------------------------------------
  describe("POST /api/v1/documents/:id/questions", () => {
    it("answers questions grounded on the document with valid source citations", async () => {
      const res = await request(app)
        .post(`/api/v1/documents/${uploadedDocId}/questions`)
        .set("Authorization", `Bearer ${userAToken}`)
        .send({ question: "What is photosynthesis and what does it convert?" });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("answer");
      expect(res.body.answer.length).toBeGreaterThan(0);
      expect(res.body.hasSufficientEvidence).toBe(true);
      expect(Array.isArray(res.body.sources)).toBe(true);
      expect(res.body.sources.length).toBeGreaterThanOrEqual(1);

      const source = res.body.sources[0];
      expect(source.documentId).toBe(uploadedDocId);
      expect(source.page).toBe(1);
      expect(typeof source.chunkId).toBe("string");
      expect(typeof source.excerpt).toBe("string");
    });

    it("returns insufficient evidence response without fabricated citations for completely unrelated question", async () => {
      const res = await request(app)
        .post(`/api/v1/documents/${uploadedDocId}/questions`)
        .set("Authorization", `Bearer ${userAToken}`)
        .send({ question: "What is the capital of Mars and the speed of light in vacuum?" });

      expect(res.status).toBe(200);
      expect(res.body.hasSufficientEvidence).toBe(false);
      expect(res.body.sources).toEqual([]);
      expect(res.body.answer).toContain("could not find sufficient information");
    });

    it("rejects User B from asking questions on User A's document with 404 (cross-user isolation)", async () => {
      const res = await request(app)
        .post(`/api/v1/documents/${uploadedDocId}/questions`)
        .set("Authorization", `Bearer ${userBToken}`)
        .send({ question: "Can I access this document?" });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("rejects empty question string with 400", async () => {
      const res = await request(app)
        .post(`/api/v1/documents/${uploadedDocId}/questions`)
        .set("Authorization", `Bearer ${userAToken}`)
        .send({ question: "   " });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  // --------------------------------------------------------------------------
  // 4. Document Deletion & Cascade Verification
  // --------------------------------------------------------------------------
  describe("DELETE /api/v1/documents/:id", () => {
    it("rejects User B from deleting User A's document with 404", async () => {
      const res = await request(app)
        .delete(`/api/v1/documents/${uploadedDocId}`)
        .set("Authorization", `Bearer ${userBToken}`);

      expect(res.status).toBe(404);
    });

    it("successfully deletes document, unlinks storage file, and removes derived chunks", async () => {
      // Fetch storage key before deletion
      const docBefore = await prisma.document.findUnique({
        where: { id: uploadedDocId },
      });
      expect(docBefore).not.toBeNull();
      const storageKey = docBefore!.storageKey;

      const res = await request(app)
        .delete(`/api/v1/documents/${uploadedDocId}`)
        .set("Authorization", `Bearer ${userAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain("deleted successfully");

      // Verify DB record was purged
      const docAfter = await prisma.document.findUnique({
        where: { id: uploadedDocId },
      });
      expect(docAfter).toBeNull();

      // Verify chunks were purged
      const chunksAfter = await prisma.documentChunk.count({
        where: { documentId: uploadedDocId },
      });
      expect(chunksAfter).toBe(0);

      // Verify storage file on disk was removed
      const fullDiskPath = path.resolve(process.cwd(), "uploads/documents", storageKey);
      await expect(fs.access(fullDiskPath)).rejects.toThrow();

      // Subsequent retrieval returns 404
      const getRes = await request(app)
        .get(`/api/v1/documents/${uploadedDocId}`)
        .set("Authorization", `Bearer ${userAToken}`);
      expect(getRes.status).toBe(404);
    });
  });
});
