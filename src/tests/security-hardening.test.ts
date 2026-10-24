import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../app";
import { prisma } from "../config/prisma";
import { fileStorageService } from "../utils/file-storage";
import { MessageRole } from "../generated/prisma/enums";

describe("Phase 8: Security Hardening & Cross-User Authorization (IDOR)", () => {
  let userAToken: string;
  let userAId: string;
  const userAEmail = `sec_a_${Date.now()}@example.com`;
  const userAPassword = "SecurePassword123!";

  let userBId: string;
  const userBEmail = `sec_b_${Date.now()}@example.com`;
  const userBPassword = "SecurePassword123!";

  // User B's resources to test unauthorized access by User A
  let userBConvId: string;
  let userBDocId: string;
  let userBQuizId: string;
  let userBAttemptId: string;
  let userBPlanId: string;
  let userBTaskId: string;
  let userBMessageId: string;

  beforeAll(async () => {
    // 1. Register User A
    const regResA = await request(app).post("/api/v1/auth/register").send({
      email: userAEmail,
      password: userAPassword,
      displayName: "Security Alice",
    });
    userAToken = regResA.body.token;
    userAId = regResA.body.user.id;

    // 2. Register User B
    const regResB = await request(app).post("/api/v1/auth/register").send({
      email: userBEmail,
      password: userBPassword,
      displayName: "Security Bob",
    });
    userBId = regResB.body.user.id;

    // 3. Seed User B's resources
    // Conversation & Message
    const conv = await prisma.conversation.create({
      data: { userId: userBId, title: "Bob Private Conversation" },
    });
    userBConvId = conv.id;

    const msg = await prisma.message.create({
      data: {
        conversationId: userBConvId,
        role: MessageRole.USER,
        content: "Bob private confidential message",
      },
    });
    userBMessageId = msg.id;

    // Document & Chunks
    const fakePdf = Buffer.from("%PDF-1.4 private document for Bob\n%%EOF");
    const { storageKey } = await fileStorageService.saveDocumentFile(
      userBId,
      "sec-doc-uuid",
      fakePdf
    );
    const doc = await prisma.document.create({
      data: {
        userId: userBId,
        originalName: "bob-private.pdf",
        mimeType: "application/pdf",
        sizeBytes: BigInt(fakePdf.length),
        storageKey,
        status: "READY",
      },
    });
    userBDocId = doc.id;

    // Quiz & Attempt
    const quiz = await prisma.quiz.create({
      data: {
        userId: userBId,
        title: "Bob Private Quiz",
        questionCount: 1,
      },
    });
    userBQuizId = quiz.id;

    const attempt = await prisma.quizAttempt.create({
      data: {
        quizId: userBQuizId,
        userId: userBId,
        totalQuestions: 1,
      },
    });
    userBAttemptId = attempt.id;

    // Study Plan & Task
    const plan = await prisma.studyPlan.create({
      data: {
        userId: userBId,
        title: "Bob Private Study Plan",
        dailyMinutes: 60,
      },
    });
    userBPlanId = plan.id;

    const task = await prisma.studyTask.create({
      data: {
        planId: userBPlanId,
        title: "Bob Private Study Task",
        scheduledDate: new Date(),
        durationMinutes: 45,
      },
    });
    userBTaskId = task.id;
  });

  afterAll(async () => {
    try {
      if (userAId) {
        await fileStorageService.deleteUserStorage(userAId);
        await prisma.user.deleteMany({ where: { id: userAId } });
      }
      if (userBId) {
        await fileStorageService.deleteUserStorage(userBId);
        await prisma.user.deleteMany({ where: { id: userBId } });
      }
    } catch {
      // Best effort cleanup
    }
  });

  describe("SQL Injection Resilience", () => {
    it("rejects malicious SQL injection syntax in route UUID parameters", async () => {
      const maliciousIds = [
        "1' OR '1'='1",
        "'; DROP TABLE \"User\"; --",
        "00000000-0000-0000-0000-000000000000' UNION SELECT * FROM \"User\" --",
      ];

      for (const badId of maliciousIds) {
        const res = await request(app)
          .get(`/api/v1/conversations/${encodeURIComponent(badId)}`)
          .set("Authorization", `Bearer ${userAToken}`);

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("VALIDATION_ERROR");
      }
    });

    it("safely parameterises SQL statements in search/text fields without executing syntax", async () => {
      const sqlInjectionTitle = "Safe Title'; DROP TABLE \"AIUsage\"; --";
      const res = await request(app)
        .post("/api/v1/conversations")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({ title: sqlInjectionTitle });

      expect(res.status).toBe(201);
      expect(res.body.title).toBe(sqlInjectionTitle);

      // Verify AIUsage table still exists and queryable
      const usageCount = await prisma.aIUsage.count();
      expect(usageCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Cross-User Authorization & IDOR Protection", () => {
    it("denies User A from reading User B's conversation (404/403)", async () => {
      const res = await request(app)
        .get(`/api/v1/conversations/${userBConvId}`)
        .set("Authorization", `Bearer ${userAToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("denies User A from reading messages in User B's conversation", async () => {
      const res = await request(app)
        .get(`/api/v1/conversations/${userBConvId}/messages`)
        .set("Authorization", `Bearer ${userAToken}`);

      expect(res.status).toBe(404);
    });

    it("denies User A from sending a message into User B's conversation", async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${userBConvId}/messages`)
        .set("Authorization", `Bearer ${userAToken}`)
        .send({ content: "Unauthorized intrusion message" });

      expect(res.status).toBe(404);
    });

    it("denies User A from renaming User B's conversation", async () => {
      const res = await request(app)
        .patch(`/api/v1/conversations/${userBConvId}`)
        .set("Authorization", `Bearer ${userAToken}`)
        .send({ title: "Hacked Title" });

      expect(res.status).toBe(404);
    });

    it("denies User A from deleting User B's conversation", async () => {
      const res = await request(app)
        .delete(`/api/v1/conversations/${userBConvId}`)
        .set("Authorization", `Bearer ${userAToken}`);

      expect(res.status).toBe(404);
    });

    it("denies User A from accessing User B's document details", async () => {
      const res = await request(app)
        .get(`/api/v1/documents/${userBDocId}`)
        .set("Authorization", `Bearer ${userAToken}`);

      expect(res.status).toBe(404);
    });

    it("denies User A from querying User B's document via Q&A", async () => {
      const res = await request(app)
        .post(`/api/v1/documents/${userBDocId}/questions`)
        .set("Authorization", `Bearer ${userAToken}`)
        .send({ question: "What are Bob's private contents?" });

      expect(res.status).toBe(404);
    });

    it("denies User A from deleting User B's document", async () => {
      const res = await request(app)
        .delete(`/api/v1/documents/${userBDocId}`)
        .set("Authorization", `Bearer ${userAToken}`);

      expect(res.status).toBe(404);
    });

    it("denies User A from viewing User B's quiz details", async () => {
      const res = await request(app)
        .get(`/api/v1/quizzes/${userBQuizId}`)
        .set("Authorization", `Bearer ${userAToken}`);

      expect(res.status).toBe(404);
    });

    it("denies User A from starting an attempt on User B's quiz", async () => {
      const res = await request(app)
        .post(`/api/v1/quizzes/${userBQuizId}/attempts`)
        .set("Authorization", `Bearer ${userAToken}`);

      expect(res.status).toBe(404);
    });

    it("denies User A from viewing User B's quiz attempt", async () => {
      const res = await request(app)
        .get(`/api/v1/quiz-attempts/${userBAttemptId}`)
        .set("Authorization", `Bearer ${userAToken}`);

      expect(res.status).toBe(404);
    });

    it("denies User A from viewing User B's study plan", async () => {
      const res = await request(app)
        .get(`/api/v1/study-plans/${userBPlanId}`)
        .set("Authorization", `Bearer ${userAToken}`);

      expect(res.status).toBe(404);
    });

    it("denies User A from updating User B's study task", async () => {
      const res = await request(app)
        .patch(`/api/v1/study-tasks/${userBTaskId}`)
        .set("Authorization", `Bearer ${userAToken}`)
        .send({ status: "COMPLETED" });

      expect(res.status).toBe(404);
    });

    it("denies User A from submitting feedback for User B's message (403 Forbidden)", async () => {
      const res = await request(app)
        .post("/api/v1/feedback")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({
          messageId: userBMessageId,
          rating: "inaccurate",
          comment: "Unauthorized feedback attempt",
        });

      expect(res.status).toBe(403);
    });
  });

  describe("Payload Limits & File Upload Security", () => {
    it("rejects prompt exceeding 8,000 characters with 400 Validation Error", async () => {
      const oversizePrompt = "A".repeat(8001);
      const res = await request(app)
        .post("/api/v1/conversations")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({ title: "Valid Title" });

      const convId = res.body.id;

      const msgRes = await request(app)
        .post(`/api/v1/conversations/${convId}/messages`)
        .set("Authorization", `Bearer ${userAToken}`)
        .send({ content: oversizePrompt });

      expect(msgRes.status).toBe(400);
      expect(msgRes.body.error.code).toBe("VALIDATION_ERROR");
      expect(msgRes.body.error.details[0].message).toContain("8000");
    });

    it("rejects non-PDF files disguised with .pdf extension (invalid magic bytes)", async () => {
      const fakeExecutable = Buffer.from("MZ\x90\x00\x03\x00\x00\x00 executable malware simulation");
      const res = await request(app)
        .post("/api/v1/documents")
        .set("Authorization", `Bearer ${userAToken}`)
        .attach("file", fakeExecutable, {
          filename: "malware.pdf",
          contentType: "application/pdf",
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain("valid PDF");
    });

    it("rejects empty uploaded file (0 bytes)", async () => {
      const emptyBuffer = Buffer.alloc(0);
      const res = await request(app)
        .post("/api/v1/documents")
        .set("Authorization", `Bearer ${userAToken}`)
        .attach("file", emptyBuffer, {
          filename: "empty.pdf",
          contentType: "application/pdf",
        });

      expect(res.status).toBe(400);
    });
  });

  describe("Security Headers, Secrets & CORS", () => {
    it("returns Helmet security headers on API responses", async () => {
      const res = await request(app).get("/health");

      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
      expect(res.headers["x-download-options"]).toBe("noopen");
    });

    it("sanitizes responses so passwordHash and tokenHash are never returned", async () => {
      const res = await request(app)
        .get("/api/v1/me")
        .set("Authorization", `Bearer ${userAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.passwordHash).toBeUndefined();
      expect(res.body.tokenHash).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain("passwordHash");
    });
  });
});
