import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { prisma, disconnectDatabase } from "../config/prisma";
import { authService } from "../modules/auth/auth.service";

describe("Phase 6: Personalized Study-Plan Generation and Task Management", () => {
  const app = createApp();
  const testRunId = Date.now();

  let userAId = "";
  let userAToken = "";
  let userBId = "";
  let userBToken = "";
  let planId = "";
  let taskId1 = "";
  let taskId2 = "";

  beforeAll(async () => {
    // 1. Create User A
    const sessionA = await authService.register({
      email: `plan.user.a.${testRunId}@example.com`,
      password: "Password123!",
      displayName: "Plan Student A",
    });
    userAId = sessionA.user.id;
    userAToken = sessionA.token;

    // 2. Create User B (for negative cross-user authorization tests)
    const sessionB = await authService.register({
      email: `plan.user.b.${testRunId}@example.com`,
      password: "Password123!",
      displayName: "Plan Student B",
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
  // 1. Study Plan Generation (POST /api/v1/study-plans)
  // --------------------------------------------------------------------------
  describe("POST /api/v1/study-plans", () => {
    it("successfully creates a study plan with structured tasks", async () => {
      const futureExamDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]!;

      const res = await request(app)
        .post("/api/v1/study-plans")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({
          title: "NEET 2026 Intensive",
          examDate: futureExamDate,
          dailyMinutes: 90,
          timezone: "Asia/Kolkata",
          subjects: ["Physics", "Chemistry", "Biology"],
          preferences: { pace: "INTENSE", focus: "PROBLEM_SOLVING" },
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("id");
      expect(res.body.title).toBe("NEET 2026 Intensive");
      expect(res.body.dailyMinutes).toBe(90);
      expect(res.body.status).toBe("ACTIVE");
      expect(Array.isArray(res.body.tasks)).toBe(true);
      expect(res.body.tasks.length).toBeGreaterThanOrEqual(5);

      planId = res.body.id;
      taskId1 = res.body.tasks[0].id;
      taskId2 = res.body.tasks[1].id;

      // Verify that tasks are persisted in PostgreSQL
      const dbTasks = await prisma.studyTask.findMany({
        where: { planId },
        orderBy: [{ scheduledDate: "asc" }, { orderIndex: "asc" }],
      });
      expect(dbTasks.length).toBe(res.body.tasks.length);
    });

    it("rejects plan generation with an exam date in the past", async () => {
      const pastDate = "2020-01-01";

      const res = await request(app)
        .post("/api/v1/study-plans")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({
          title: "Past Plan",
          examDate: pastDate,
          dailyMinutes: 60,
          subjects: ["History"],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain("cannot be in the past");
    });

    it("rejects plan generation with empty subjects list", async () => {
      const res = await request(app)
        .post("/api/v1/study-plans")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({
          title: "No Subjects Plan",
          dailyMinutes: 60,
          subjects: [],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects plan generation with invalid daily study minutes (< 15 or > 720)", async () => {
      const res = await request(app)
        .post("/api/v1/study-plans")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({
          title: "Invalid Minutes Plan",
          dailyMinutes: 5, // Below 15 min limit
          subjects: ["Math"],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      const detail = res.body.error.details.find((d: { field: string }) => d.field === "dailyMinutes");
      expect(detail).toBeDefined();
      expect(detail.message).toContain("at least 15 minutes");
    });

    it("rejects duplicate plan generation within 3 seconds (rate limit guard)", async () => {
      // Send immediate duplicate with identical title
      const res = await request(app)
        .post("/api/v1/study-plans")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({
          title: "NEET 2026 Intensive",
          dailyMinutes: 90,
          subjects: ["Physics", "Chemistry"],
        });

      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe("RATE_LIMIT_EXCEEDED");
    });
  });

  // --------------------------------------------------------------------------
  // 2. Listing & Retrieving Plans
  // --------------------------------------------------------------------------
  describe("GET /api/v1/study-plans & GET /api/v1/study-plans/:id", () => {
    it("lists only User A's study plans", async () => {
      const res = await request(app)
        .get("/api/v1/study-plans")
        .set("Authorization", `Bearer ${userAToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("studyPlans");
      const found = res.body.studyPlans.find((p: { id: string }) => p.id === planId);
      expect(found).toBeDefined();
    });

    it("returns empty study plans list for User B (cross-user isolation)", async () => {
      const res = await request(app)
        .get("/api/v1/study-plans")
        .set("Authorization", `Bearer ${userBToken}`);

      expect(res.status).toBe(200);
      const found = res.body.studyPlans.find((p: { id: string }) => p.id === planId);
      expect(found).toBeUndefined();
    });

    it("retrieves single study plan details for owner User A", async () => {
      const res = await request(app)
        .get(`/api/v1/study-plans/${planId}`)
        .set("Authorization", `Bearer ${userAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(planId);
      expect(res.body.dailyMinutes).toBe(90);
      expect(Array.isArray(res.body.tasks)).toBe(true);
    });

    it("rejects User B from retrieving User A's plan with 404", async () => {
      const res = await request(app)
        .get(`/api/v1/study-plans/${planId}`)
        .set("Authorization", `Bearer ${userBToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });

  // --------------------------------------------------------------------------
  // 3. Updating Plan Metadata (PATCH /api/v1/study-plans/:id)
  // --------------------------------------------------------------------------
  describe("PATCH /api/v1/study-plans/:id", () => {
    it("updates study plan title and status", async () => {
      const res = await request(app)
        .patch(`/api/v1/study-plans/${planId}`)
        .set("Authorization", `Bearer ${userAToken}`)
        .send({
          title: "NEET 2026 Revised Plan",
          status: "COMPLETED",
        });

      expect(res.status).toBe(200);
      expect(res.body.title).toBe("NEET 2026 Revised Plan");
      expect(res.body.status).toBe("COMPLETED");
    });

    it("rejects User B from updating User A's plan with 404", async () => {
      const res = await request(app)
        .patch(`/api/v1/study-plans/${planId}`)
        .set("Authorization", `Bearer ${userBToken}`)
        .send({ title: "Hacked Title" });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });

  // --------------------------------------------------------------------------
  // 4. Task Management (PATCH /study-tasks/:id, POST /tasks, DELETE /tasks)
  // --------------------------------------------------------------------------
  describe("Study Tasks Management", () => {
    it("marks task as COMPLETED and automatically records completedAt timestamp", async () => {
      const res = await request(app)
        .patch(`/api/v1/study-tasks/${taskId1}`)
        .set("Authorization", `Bearer ${userAToken}`)
        .send({ status: "COMPLETED" });

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(taskId1);
      expect(res.body.status).toBe("COMPLETED");
      expect(res.body.completedAt).toBeDefined();
    });

    it("resets completedAt to null when task status is set back to TODO", async () => {
      const res = await request(app)
        .patch(`/api/v1/study-tasks/${taskId1}`)
        .set("Authorization", `Bearer ${userAToken}`)
        .send({ status: "TODO" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("TODO");
      expect(res.body.completedAt).toBeNull();
    });

    it("updates task title, duration, and scheduledDate", async () => {
      const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0]!;

      const res = await request(app)
        .patch(`/api/v1/study-tasks/${taskId2}`)
        .set("Authorization", `Bearer ${userAToken}`)
        .send({
          title: "Thermodynamics Extra Practice",
          durationMinutes: 45,
          scheduledDate: tomorrow,
        });

      expect(res.status).toBe(200);
      expect(res.body.title).toBe("Thermodynamics Extra Practice");
      expect(res.body.durationMinutes).toBe(45);
    });

    it("rejects User B from modifying User A's task with 404", async () => {
      const res = await request(app)
        .patch(`/api/v1/study-tasks/${taskId1}`)
        .set("Authorization", `Bearer ${userBToken}`)
        .send({ status: "COMPLETED" });

      expect(res.status).toBe(404);
    });

    it("adds a custom task to the study plan", async () => {
      const scheduledDate = new Date(Date.now() + 2 * 86400000).toISOString().split("T")[0]!;

      const res = await request(app)
        .post(`/api/v1/study-plans/${planId}/tasks`)
        .set("Authorization", `Bearer ${userAToken}`)
        .send({
          title: "Custom Mock Test",
          topic: "Full Syllabus",
          scheduledDate,
          durationMinutes: 60,
        });

      expect(res.status).toBe(201);
      expect(res.body.title).toBe("Custom Mock Test");
      expect(res.body.durationMinutes).toBe(60);
      expect(res.body.status).toBe("TODO");

      // Clean up the custom task
      const customTaskId = res.body.id;
      const delRes = await request(app)
        .delete(`/api/v1/study-tasks/${customTaskId}`)
        .set("Authorization", `Bearer ${userAToken}`);
      expect(delRes.status).toBe(200);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Plan Regeneration & Completed Task Preservation
  // --------------------------------------------------------------------------
  describe("POST /api/v1/study-plans/:id/regenerate", () => {
    it("regenerates plan and PRESERVES completed tasks while replacing uncompleted ones", async () => {
      // First, mark taskId1 as COMPLETED
      await request(app)
        .patch(`/api/v1/study-tasks/${taskId1}`)
        .set("Authorization", `Bearer ${userAToken}`)
        .send({ status: "COMPLETED" });

      const res = await request(app)
        .post(`/api/v1/study-plans/${planId}/regenerate`)
        .set("Authorization", `Bearer ${userAToken}`)
        .send({
          preserveCompleted: true,
          dailyMinutes: 100,
        });

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(planId);
      expect(res.body.dailyMinutes).toBe(100);

      // Verify that taskId1 (COMPLETED) is still present in the plan!
      const preservedTask = res.body.tasks.find((t: { id: string }) => t.id === taskId1);
      expect(preservedTask).toBeDefined();
      expect(preservedTask.status).toBe("COMPLETED");

      // Verify that taskId2 (was TODO) was replaced
      const replacedTask = res.body.tasks.find((t: { id: string }) => t.id === taskId2);
      expect(replacedTask).toBeUndefined();
    });

    it("rejects User B from regenerating User A's plan with 404", async () => {
      const res = await request(app)
        .post(`/api/v1/study-plans/${planId}/regenerate`)
        .set("Authorization", `Bearer ${userBToken}`)
        .send({ preserveCompleted: true });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });

  // --------------------------------------------------------------------------
  // 6. Plan Deletion (DELETE /api/v1/study-plans/:id)
  // --------------------------------------------------------------------------
  describe("DELETE /api/v1/study-plans/:id", () => {
    it("rejects User B from deleting User A's plan with 404", async () => {
      const res = await request(app)
        .delete(`/api/v1/study-plans/${planId}`)
        .set("Authorization", `Bearer ${userBToken}`);

      expect(res.status).toBe(404);
    });

    it("successfully soft deletes study plan", async () => {
      const res = await request(app)
        .delete(`/api/v1/study-plans/${planId}`)
        .set("Authorization", `Bearer ${userAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain("deleted successfully");

      // Subsequent fetch returns 404
      const getRes = await request(app)
        .get(`/api/v1/study-plans/${planId}`)
        .set("Authorization", `Bearer ${userAToken}`);

      expect(getRes.status).toBe(404);
    });
  });
});
