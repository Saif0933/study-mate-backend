import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { prisma, disconnectDatabase } from "../config/prisma";
import { authService } from "../modules/auth/auth.service";

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

describe("Phase 5: Quiz Generation, Attempts, Responses & Scoring", () => {
  const app = createApp();
  const testRunId = Date.now();

  let userAId = "";
  let userAToken = "";
  let userBId = "";
  let userBToken = "";
  let userADocId = "";
  let topicQuizId = "";
  let docQuizId = "";
  let activeAttemptId = "";

  beforeAll(async () => {
    // 1. Create User A
    const sessionA = await authService.register({
      email: `quiz.user.a.${testRunId}@example.com`,
      password: "Password123!",
      displayName: "Quiz Student A",
    });
    userAId = sessionA.user.id;
    userAToken = sessionA.token;

    // 2. Create User B (for cross-user isolation verification)
    const sessionB = await authService.register({
      email: `quiz.user.b.${testRunId}@example.com`,
      password: "Password123!",
      displayName: "Quiz Student B",
    });
    userBId = sessionB.user.id;
    userBToken = sessionB.token;

    // 3. Upload a sample document for User A to READY state
    const pdfBuffer = createSamplePdfBuffer(
      "Cellular biology examines cellular structure, organelles such as mitochondria and chloroplasts, and energy metabolism."
    );
    const docRes = await request(app)
      .post("/api/v1/documents")
      .set("Authorization", `Bearer ${userAToken}`)
      .attach("file", pdfBuffer, "biology_chapter.pdf");

    expect(docRes.status).toBe(201);
    expect(docRes.body.status).toBe("READY");
    userADocId = docRes.body.id;
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
  // 1. Quiz Generation (POST /api/v1/quizzes)
  // --------------------------------------------------------------------------
  describe("POST /api/v1/quizzes", () => {
    it("successfully generates a topic-based quiz with 5 questions", async () => {
      const res = await request(app)
        .post("/api/v1/quizzes")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({
          title: "Quantum Physics Quick Check",
          topic: "Quantum Physics",
          difficulty: "HARD",
          questionCount: 5,
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("id");
      expect(res.body.title).toBe("Quantum Physics Quick Check");
      expect(res.body.topic).toBe("Quantum Physics");
      expect(res.body.difficulty).toBe("HARD");
      expect(res.body.questionCount).toBe(5);
      expect(res.body.status).toBe("READY");

      topicQuizId = res.body.id;

      // Verify that questions were persisted in DB with answer keys and options
      const dbQuestions = await prisma.quizQuestion.findMany({
        where: { quizId: topicQuizId },
        orderBy: { orderIndex: "asc" },
      });
      expect(dbQuestions).toHaveLength(5);
      for (const q of dbQuestions) {
        expect(Array.isArray(q.options)).toBe(true);
        expect((q.options as string[]).length).toBe(4);
        expect(q.correctAnswer.length).toBeGreaterThan(0);
      }
    });

    it("successfully generates a quiz grounded on a ready PDF document", async () => {
      const res = await request(app)
        .post("/api/v1/quizzes")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({
          title: "Cellular Biology Document Quiz",
          sourceDocumentId: userADocId,
          difficulty: "MEDIUM",
          questionCount: 3,
        });

      expect(res.status).toBe(201);
      expect(res.body.sourceDocumentId).toBe(userADocId);
      expect(res.body.questionCount).toBe(3);

      docQuizId = res.body.id;
    });

    it("rejects quiz generation when both topic and sourceDocumentId are missing", async () => {
      const res = await request(app)
        .post("/api/v1/quizzes")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({
          title: "Nameless Quiz",
          difficulty: "EASY",
          questionCount: 5,
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects quiz generation using User A's document by User B (cross-user isolation)", async () => {
      const res = await request(app)
        .post("/api/v1/quizzes")
        .set("Authorization", `Bearer ${userBToken}`)
        .send({
          sourceDocumentId: userADocId,
          questionCount: 5,
        });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });

  // --------------------------------------------------------------------------
  // 2. Listing & Retrieving Quizzes
  // --------------------------------------------------------------------------
  describe("GET /api/v1/quizzes & GET /api/v1/quizzes/:id", () => {
    it("lists only User A's generated quizzes", async () => {
      const res = await request(app)
        .get("/api/v1/quizzes")
        .set("Authorization", `Bearer ${userAToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("quizzes");
      expect(res.body.quizzes.length).toBeGreaterThanOrEqual(2);
      const found = res.body.quizzes.find((q: { id: string }) => q.id === topicQuizId);
      expect(found).toBeDefined();
    });

    it("returns empty quiz list for User B (cross-user isolation)", async () => {
      const res = await request(app)
        .get("/api/v1/quizzes")
        .set("Authorization", `Bearer ${userBToken}`);

      expect(res.status).toBe(200);
      const found = res.body.quizzes.find((q: { id: string }) => q.id === topicQuizId);
      expect(found).toBeUndefined();
    });

    it("retrieves single quiz details for owner", async () => {
      const res = await request(app)
        .get(`/api/v1/quizzes/${topicQuizId}`)
        .set("Authorization", `Bearer ${userAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(topicQuizId);
      expect(res.body.difficulty).toBe("HARD");
    });

    it("rejects User B from retrieving User A's quiz with 404", async () => {
      const res = await request(app)
        .get(`/api/v1/quizzes/${topicQuizId}`)
        .set("Authorization", `Bearer ${userBToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });

  // --------------------------------------------------------------------------
  // 3. Starting Quiz Attempt & Answer Masking
  // --------------------------------------------------------------------------
  describe("POST /api/v1/quizzes/:id/attempts", () => {
    it("starts a new attempt and MASKS answer keys and explanations from questions", async () => {
      const res = await request(app)
        .post(`/api/v1/quizzes/${topicQuizId}/attempts`)
        .set("Authorization", `Bearer ${userAToken}`);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("id");
      expect(res.body.quizId).toBe(topicQuizId);
      expect(res.body.status).toBe("IN_PROGRESS");
      expect(res.body.score).toBeNull();
      expect(res.body.totalQuestions).toBe(5);
      expect(Array.isArray(res.body.questions)).toBe(true);
      expect(res.body.questions).toHaveLength(5);

      activeAttemptId = res.body.id;

      // CRITICAL SECURITY CHECK: Ensure correctAnswer & explanation are NOT in the active response
      for (const q of res.body.questions) {
        expect(q).toHaveProperty("id");
        expect(q).toHaveProperty("prompt");
        expect(q).toHaveProperty("options");
        expect(q.correctAnswer).toBeUndefined();
        expect(q.explanation).toBeUndefined();
      }
    });

    it("rejects User B from starting an attempt on User A's quiz with 404", async () => {
      const res = await request(app)
        .post(`/api/v1/quizzes/${topicQuizId}/attempts`)
        .set("Authorization", `Bearer ${userBToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });

  // --------------------------------------------------------------------------
  // 4. Submitting Attempt & Server-Side Scoring
  // --------------------------------------------------------------------------
  describe("POST /api/v1/quiz-attempts/:id/submit", () => {
    it("accurately calculates score on server and returns comprehensive review", async () => {
      // Fetch stored questions to know the exact answers
      const storedQuestions = await prisma.quizQuestion.findMany({
        where: { quizId: topicQuizId },
        orderBy: { orderIndex: "asc" },
      });

      // Prepare responses: first 3 correct, last 2 intentionally wrong
      const responses = [
        { questionId: storedQuestions[0]!.id, selectedAnswer: storedQuestions[0]!.correctAnswer },
        { questionId: storedQuestions[1]!.id, selectedAnswer: storedQuestions[1]!.correctAnswer },
        { questionId: storedQuestions[2]!.id, selectedAnswer: storedQuestions[2]!.correctAnswer },
        { questionId: storedQuestions[3]!.id, selectedAnswer: "Wrong Answer Definitely" },
        { questionId: storedQuestions[4]!.id, selectedAnswer: "Another Wrong Choice" },
      ];

      const res = await request(app)
        .post(`/api/v1/quiz-attempts/${activeAttemptId}/submit`)
        .set("Authorization", `Bearer ${userAToken}`)
        .send({ responses });

      expect(res.status).toBe(200);
      expect(res.body.attemptId).toBe(activeAttemptId);
      expect(res.body.score).toBe(3); // 3 correct out of 5
      expect(res.body.totalQuestions).toBe(5);
      expect(Array.isArray(res.body.review)).toBe(true);
      expect(res.body.review).toHaveLength(5);

      // Verify individual review items reveal correct answers and explanations
      const review1 = res.body.review.find((r: { questionId: string }) => r.questionId === storedQuestions[0]!.id);
      expect(review1.isCorrect).toBe(true);
      expect(review1.correctAnswer).toBe(storedQuestions[0]!.correctAnswer);
      expect(review1.explanation).toBeDefined();

      const review4 = res.body.review.find((r: { questionId: string }) => r.questionId === storedQuestions[3]!.id);
      expect(review4.isCorrect).toBe(false);
      expect(review4.selectedAnswer).toBe("Wrong Answer Definitely");
      expect(review4.correctAnswer).toBe(storedQuestions[3]!.correctAnswer);
    });

    it("idempotently returns existing score when submitted again without corrupting results", async () => {
      const res = await request(app)
        .post(`/api/v1/quiz-attempts/${activeAttemptId}/submit`)
        .set("Authorization", `Bearer ${userAToken}`)
        .send({ responses: [] });

      expect(res.status).toBe(200);
      expect(res.body.score).toBe(3);
      expect(res.body.totalQuestions).toBe(5);
    });

    it("rejects submission with question ID that does not belong to the quiz", async () => {
      // Start another attempt for docQuizId
      const newAttemptRes = await request(app)
        .post(`/api/v1/quizzes/${docQuizId}/attempts`)
        .set("Authorization", `Bearer ${userAToken}`);
      const newAttemptId = newAttemptRes.body.id;

      // Submit with a fake question ID
      const res = await request(app)
        .post(`/api/v1/quiz-attempts/${newAttemptId}/submit`)
        .set("Authorization", `Bearer ${userAToken}`)
        .send({
          responses: [{ questionId: "00000000-0000-0000-0000-000000000000", selectedAnswer: "Test" }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain("does not belong to this quiz");
    });

    it("rejects User B from submitting answers for User A's attempt with 404 (cross-user isolation)", async () => {
      const res = await request(app)
        .post(`/api/v1/quiz-attempts/${activeAttemptId}/submit`)
        .set("Authorization", `Bearer ${userBToken}`)
        .send({ responses: [] });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });

  // --------------------------------------------------------------------------
  // 5. Attempt History & Past Review (GET /quiz-attempts/:id & /quizzes/:id/attempts)
  // --------------------------------------------------------------------------
  describe("GET /api/v1/quiz-attempts/:id & GET /api/v1/quizzes/:id/attempts", () => {
    it("retrieves past completed attempt review for owner User A", async () => {
      const res = await request(app)
        .get(`/api/v1/quiz-attempts/${activeAttemptId}`)
        .set("Authorization", `Bearer ${userAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.attemptId).toBe(activeAttemptId);
      expect(res.body.score).toBe(3);
      expect(res.body.review).toHaveLength(5);
    });

    it("rejects User B from viewing User A's attempt review with 404", async () => {
      const res = await request(app)
        .get(`/api/v1/quiz-attempts/${activeAttemptId}`)
        .set("Authorization", `Bearer ${userBToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("lists all past attempts for a quiz", async () => {
      const res = await request(app)
        .get(`/api/v1/quizzes/${topicQuizId}/attempts`)
        .set("Authorization", `Bearer ${userAToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("attempts");
      expect(res.body.attempts.length).toBeGreaterThanOrEqual(1);
      expect(res.body.attempts[0].id).toBe(activeAttemptId);
    });

    it("rejects User B from listing attempts for User A's quiz with 404", async () => {
      const res = await request(app)
        .get(`/api/v1/quizzes/${topicQuizId}/attempts`)
        .set("Authorization", `Bearer ${userBToken}`);

      expect(res.status).toBe(404);
    });
  });
});
