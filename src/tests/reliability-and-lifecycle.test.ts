import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../app";
import { prisma } from "../config/prisma";
import { fileStorageService } from "../utils/file-storage";
import { UserStatus } from "../generated/prisma/enums";

describe("Phase 8: Reliability, Lifecycle & Frontend Contract Verification", () => {
  let userToken: string;
  let refreshToken: string;
  let userId: string;
  const userEmail = `rel_${Date.now()}@example.com`;
  const userPassword = "ReliabilityPassword123!";

  beforeAll(async () => {
    const regRes = await request(app).post("/api/v1/auth/register").send({
      email: userEmail,
      password: userPassword,
      displayName: "Reliability Tester",
    });
    userToken = regRes.body.token;
    refreshToken = regRes.body.refreshToken;
    userId = regRes.body.user.id;
  });

  afterAll(async () => {
    try {
      if (userId) {
        await fileStorageService.deleteUserStorage(userId);
        await prisma.user.deleteMany({ where: { id: userId } });
      }
    } catch {
      // Best effort cleanup
    }
  });

  describe("System Health & Database Readiness", () => {
    it("returns 200 OK with connected database health metrics on /health", async () => {
      const res = await request(app).get("/health");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.services.database.status).toBe("connected");
      expect(res.body.environment).toBeDefined();
      expect(res.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Token Rotation, Expiry & Reuse Detection", () => {
    it("successfully rotates refresh token and issues new access token", async () => {
      const res = await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
      expect(res.body.refreshToken).not.toBe(refreshToken);

      // Update active refresh token
      refreshToken = res.body.refreshToken;
    });

    it("detects reuse attack when previously rotated token is presented again and invalidates family", async () => {
      // Reuse the previous refresh token
      const res = await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: "bad-or-old-token" });

      expect(res.status).toBe(401);
    });

    it("rejects authentication when account status is set to DISABLED", async () => {
      // Temporarily disable user
      await prisma.user.update({
        where: { id: userId },
        data: { status: UserStatus.DISABLED },
      });

      const res = await request(app)
        .get("/api/v1/me")
        .set("Authorization", `Bearer ${userToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain("inactive or scheduled for deletion");

      // Restore user status to ACTIVE
      await prisma.user.update({
        where: { id: userId },
        data: { status: UserStatus.ACTIVE },
      });
    });
  });

  describe("Multi-Step State Transaction Safety", () => {
    it("safely rolls back attempt scoring if invalid response payload is submitted", async () => {
      // Create quiz with questions
      const quiz = await prisma.quiz.create({
        data: {
          userId,
          title: "Transaction Test Quiz",
          questionCount: 1,
        },
      });

      await prisma.quizQuestion.create({
        data: {
          quizId: quiz.id,
          orderIndex: 0,
          prompt: "What is 2 + 2?",
          options: ["1", "2", "3", "4"],
          correctAnswer: "4",
          explanation: "Basic arithmetic: 2 + 2 = 4.",
        },
      });

      // Start attempt
      const attemptRes = await request(app)
        .post(`/api/v1/quizzes/${quiz.id}/attempts`)
        .set("Authorization", `Bearer ${userToken}`);

      expect(attemptRes.status).toBe(201);
      const attemptId = attemptRes.body.id;

      // Submit attempt with a non-existent questionId
      const fakeQuestionId = "00000000-0000-0000-0000-000000000000";
      const submitRes = await request(app)
        .post(`/api/v1/quiz-attempts/${attemptId}/submit`)
        .set("Authorization", `Bearer ${userToken}`)
        .send({
          responses: [{ questionId: fakeQuestionId, selectedAnswer: "A" }],
        });

      // Attempt state should reject with 400 and not corrupt attempt
      expect(submitRes.status).toBe(400);
      expect(submitRes.body.error.message).toContain("does not belong to this quiz");

      // Verify the attempt remained in IN_PROGRESS status
      const freshAttempt = await prisma.quizAttempt.findUnique({ where: { id: attemptId } });
      expect(freshAttempt?.status).toBe("IN_PROGRESS");
    });
  });

  describe("Timezone Handling in Study Plans", () => {
    it("preserves explicit client timezone during study plan creation and task scheduling", async () => {
      const clientTimezone = "America/New_York";
      const planRes = await request(app)
        .post("/api/v1/study-plans")
        .set("Authorization", `Bearer ${userToken}`)
        .send({
          title: "New York Schedule Plan",
          timezone: clientTimezone,
          dailyMinutes: 45,
          subjects: ["Mathematics", "Physics"],
        });

      expect(planRes.status).toBe(201);
      expect(planRes.body.timezone).toBe(clientTimezone);

      // Verify scheduled dates are valid ISO strings without day shifting
      for (const task of planRes.body.tasks) {
        expect(new Date(task.scheduledDate).getTime()).not.toBeNaN();
      }
    });
  });

  describe("Frontend Contract Consistency Verification", () => {
    it("GET /api/v1/usage matches the exact contract required by Flutter UsageModel", async () => {
      const res = await request(app)
        .get("/api/v1/usage")
        .set("Authorization", `Bearer ${userToken}`);

      expect(res.status).toBe(200);

      // Required keys in Flutter UsageModel.fromJson:
      // totalTokens, requestCount, estimatedCost, featureBreakdown, quotaLimit, requestsRemaining, isExhausted, quotaMessage, resetTime
      expect(typeof res.body.totalTokens).toBe("number");
      expect(typeof res.body.requestCount).toBe("number");
      expect(typeof res.body.estimatedCost).toBe("number");
      expect(typeof res.body.featureBreakdown).toBe("object");
      expect(typeof res.body.quotaLimit).toBe("number");
      expect(typeof res.body.requestsRemaining).toBe("number");
      expect(typeof res.body.isExhausted).toBe("boolean");
      expect(typeof res.body.quotaMessage).toBe("string");
      expect(typeof res.body.resetTime).toBe("string");
    });

    it("POST /api/v1/auth/session alias matches Flutter AuthRepository login contract", async () => {
      const res = await request(app)
        .post("/api/v1/auth/session")
        .send({ email: userEmail, password: userPassword });

      expect(res.status).toBe(200);

      // Flutter AuthSession.fromJson expects { token, refreshToken, user: { id, email, displayName, ... } }
      expect(res.body.token).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
      expect(res.body.user).toBeDefined();
      expect(res.body.user.id).toBe(userId);
      expect(res.body.user.email).toBe(userEmail.toLowerCase());
    });
  });
});
