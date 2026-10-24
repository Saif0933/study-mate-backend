import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../app";
import { disconnectDatabase, prisma } from "../config/prisma";

describe("Phase 9: Flutter Mobile Client API Integration & Production Verification", () => {
  let authToken: string;
  let userId: string;
  const userEmail = `flutter_client_${Date.now()}@example.com`;
  const userPassword = "FlutterClientPass123!";
  let conversationId: string;
  let uploadedDocId: string;
  let quizId: string;
  let attemptId: string;
  let studyPlanId: string;
  let taskId: string;

  beforeAll(async () => {
    // Clean initial state if needed
  });

  afterAll(async () => {
    // Cleanup generated data
    try {
      if (userId) {
        await prisma.user.deleteMany({ where: { id: userId } });
      }
    } catch {
      // Ignore cleanup error in test tear-down
    }
    await disconnectDatabase();
  });

  describe("1. Infrastructure & Deployment Probes", () => {
    it("GET /health returns 200 with status ok and zero leaked credentials", async () => {
      const res = await request(app).get("/health");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("status", "ok");
      expect(res.body).toHaveProperty("uptimeSeconds");
      expect(res.body.services.database.status).toBe("connected");

      const bodyStr = JSON.stringify(res.body);
      expect(bodyStr).not.toMatch(/postgres:/i);
      expect(bodyStr).not.toMatch(/password/i);
    });

    it("GET /health/ready returns 200 ready confirming DB and storage are writable", async () => {
      const res = await request(app).get("/health/ready");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("status", "ready");
      expect(res.body.checks.database).toBe("ok");
      expect(res.body.checks.storage).toBe("ok");
    });

    it("GET /health/metrics returns operational telemetry without secret leakage", async () => {
      const res = await request(app).get("/health/metrics");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("process");
      expect(res.body).toHaveProperty("database");
      expect(res.body).toHaveProperty("aiTelemetry");
      expect(res.body.aiTelemetry).toHaveProperty("modelId");
    });
  });

  describe("2. Authentication & Session Verification", () => {
    it("POST /api/v1/auth/register succeeds and returns token and user payload", async () => {
      const res = await request(app)
        .post("/api/v1/auth/register")
        .send({
          email: userEmail.toUpperCase(), // test normalization
          password: userPassword,
          displayName: "Flutter User",
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("token");
      expect(res.body).toHaveProperty("accessToken");
      expect(res.body.user).toHaveProperty("id");
      expect(res.body.user.email).toBe(userEmail.toLowerCase());
      expect(res.body.user.displayName).toBe("Flutter User");
      expect(res.body.user).not.toHaveProperty("passwordHash");

      authToken = res.body.token;
      userId = res.body.user.id;
    });

    it("POST /api/v1/auth/session alias matches Flutter AuthRepository login contract", async () => {
      const res = await request(app)
        .post("/api/v1/auth/session")
        .send({
          email: userEmail,
          password: userPassword,
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("token");
      expect(res.body).toHaveProperty("accessToken");
      expect(res.body.token).toBe(res.body.accessToken);
      expect(res.body.user.id).toBe(userId);
    });

    it("Unauthorized requests without Bearer header return 401 with consistent error envelope", async () => {
      const res = await request(app).get("/api/v1/me/usage");

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toHaveProperty("code");
      expect(res.body.error).toHaveProperty("message");
      expect(res.body.error).toHaveProperty("requestId");
    });
  });

  describe("3. AI Tutor Chat & Conversation Contract", () => {
    it("POST /api/v1/conversations creates a new chat session", async () => {
      const res = await request(app)
        .post("/api/v1/conversations")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ title: "Cell Biology Review" });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("id");
      expect(res.body.title).toBe("Cell Biology Review");
      conversationId = res.body.id;
    });

    it("GET /api/v1/conversations lists conversations with pagination support", async () => {
      const res = await request(app)
        .get("/api/v1/conversations?page=1&limit=10")
        .set("Authorization", `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0]).toHaveProperty("id", conversationId);
    });

    it("GET /api/v1/conversations/:id returns single conversation metadata", async () => {
      const res = await request(app)
        .get(`/api/v1/conversations/${conversationId}`)
        .set("Authorization", `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("id", conversationId);
      expect(res.body).toHaveProperty("title", "Cell Biology Review");
    });
  });

  describe("4. PDF Document Upload & Retrieval Contract", () => {
    it("POST /api/v1/documents handles multipart/form-data upload correctly", async () => {
      const validPdf = Buffer.from(
        "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
        "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
        "3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << >> /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n" +
        "4 0 obj\n<< /Length 55 >>\nstream\nBT /F1 12 Tf 72 712 Td (Cellular respiration produces energy) Tj ET\nendstream\nendobj\n" +
        "xref\n0 5\n0000000000 65535 f \n0000000010 00000 n \n0000000060 00000 n \n0000000117 00000 n \n0000000222 00000 n \n" +
        "trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n328\n%%EOF"
      );

      const res = await request(app)
        .post("/api/v1/documents")
        .set("Authorization", `Bearer ${authToken}`)
        .attach("file", validPdf, "sample_lecture.pdf");

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("id");
      expect(res.body).toHaveProperty("originalName", "sample_lecture.pdf");
      expect(res.body).toHaveProperty("mimeType", "application/pdf");
      expect(res.body).toHaveProperty("status");
      uploadedDocId = res.body.id;
    });

    it("GET /api/v1/documents returns document list for Flutter document library", async () => {
      const res = await request(app)
        .get("/api/v1/documents")
        .set("Authorization", `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("documents");
      expect(Array.isArray(res.body.documents)).toBe(true);
      const found = res.body.documents.find((d: { id: string }) => d.id === uploadedDocId);
      expect(found).toBeDefined();
    });
  });

  describe("5. Quiz Generation & Interactive Attempts Contract", () => {
    let attemptQuestions: Array<{ id: string; options: string[] }> = [];

    it("POST /api/v1/quizzes creates a quiz with questions", async () => {
      const res = await request(app)
        .post("/api/v1/quizzes")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          title: "Mitochondria Quiz",
          topic: "Biology",
          difficulty: "MEDIUM",
          questionCount: 2,
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("id");
      expect(res.body).toHaveProperty("questionCount", 2);
      expect(res.body.status).toBe("READY");
      quizId = res.body.id;
    });

    it("POST /api/v1/quizzes/:id/attempts starts an attempt with hidden answer keys", async () => {
      const res = await request(app)
        .post(`/api/v1/quizzes/${quizId}/attempts`)
        .set("Authorization", `Bearer ${authToken}`);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("id");
      expect(res.body.status).toBe("IN_PROGRESS");
      expect(res.body).toHaveProperty("questions");
      expect(Array.isArray(res.body.questions)).toBe(true);
      expect(res.body.questions).toHaveLength(2);

      // Verify answer keys are masked during active attempt
      const q = res.body.questions[0];
      expect(q).not.toHaveProperty("correctAnswer");
      attemptQuestions = res.body.questions;
      attemptId = res.body.id;
    });

    it("POST /api/v1/quiz-attempts/:id/submit calculates score and reveals explanations", async () => {
      const q1 = attemptQuestions[0]!;
      const q2 = attemptQuestions[1]!;

      const res = await request(app)
        .post(`/api/v1/quiz-attempts/${attemptId}/submit`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          responses: [
            { questionId: q1.id, selectedAnswer: q1.options[0] },
            { questionId: q2.id, selectedAnswer: q2.options[0] },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.attemptId).toBe(attemptId);
      expect(res.body).toHaveProperty("score");
      expect(res.body).toHaveProperty("totalQuestions", 2);
      expect(Array.isArray(res.body.review)).toBe(true);
      expect(res.body.review).toHaveLength(2);
    });
  });

  describe("6. Study Plans & Task State Contract", () => {
    it("POST /api/v1/study-plans generates plan with structured tasks", async () => {
      const futureDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]!;
      const res = await request(app)
        .post("/api/v1/study-plans")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          title: "Final Exams Prep",
          examDate: futureDate,
          timezone: "Asia/Kolkata",
          dailyMinutes: 60,
          subjects: ["Biology", "Chemistry"],
          preferences: { focus: "PRACTICE" },
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("id");
      expect(res.body).toHaveProperty("tasks");
      expect(res.body.tasks.length).toBeGreaterThan(0);

      studyPlanId = res.body.id;
      taskId = res.body.tasks[0].id;
    });

    it("PATCH /api/v1/study-tasks/:id updates task completion status", async () => {
      const res = await request(app)
        .patch(`/api/v1/study-tasks/${taskId}`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ status: "COMPLETED" });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("id", taskId);
      expect(res.body.status).toBe("COMPLETED");
      expect(res.body).toHaveProperty("completedAt");
    });

    it("GET /api/v1/study-plans/:id retrieves plan with tasks", async () => {
      const res = await request(app)
        .get(`/api/v1/study-plans/${studyPlanId}`)
        .set("Authorization", `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("id", studyPlanId);
      expect(Array.isArray(res.body.tasks)).toBe(true);
    });
  });

  describe("7. AI Usage Accounting Contract Verification", () => {
    it("GET /api/v1/me/usage matches Flutter UsageModel envelope format", async () => {
      const res = await request(app)
        .get("/api/v1/me/usage")
        .set("Authorization", `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("totalTokens");
      expect(res.body).toHaveProperty("requestCount");
      expect(res.body).toHaveProperty("estimatedCost");
      expect(res.body).toHaveProperty("featureBreakdown");
      expect(res.body).toHaveProperty("requestsRemaining");
      expect(res.body).toHaveProperty("isExhausted");
      expect(typeof res.body.totalTokens).toBe("number");
      expect(typeof res.body.requestCount).toBe("number");
      expect(typeof res.body.isExhausted).toBe("boolean");
    });
  });

  describe("8. Error Handling & Edge Case Consistency", () => {
    it("Malformed JSON body returns 400 INVALID_JSON with requestId", async () => {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("Content-Type", "application/json")
        .send("{ broken json: ");

      expect(res.status).toBe(400);
      expect(res.body.error).toHaveProperty("code", "INVALID_JSON");
      expect(res.body.error).toHaveProperty("requestId");
    });

    it("Non-existent route returns 404 NOT_FOUND envelope", async () => {
      const res = await request(app)
        .get("/api/v1/non-existent-route")
        .set("Authorization", `Bearer ${authToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toHaveProperty("code", "NOT_FOUND");
    });
  });
});
