import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { prisma, disconnectDatabase } from "../config/prisma";
import { authService } from "../modules/auth/auth.service";

describe("Phase 3: Conversations & AI Tutor Integration", () => {
  const app = createApp();
  const testRunId = Date.now();

  let userAId = "";
  let userAToken = "";
  let userBId = "";
  let userBToken = "";
  let conversationId = "";

  beforeAll(async () => {
    // Create User A
    const sessionA = await authService.register({
      email: `tutor.user.a.${testRunId}@example.com`,
      password: "Password123!",
      displayName: "Student A",
    });
    userAId = sessionA.user.id;
    userAToken = sessionA.token;

    // Create User B (for negative authorization testing)
    const sessionB = await authService.register({
      email: `tutor.user.b.${testRunId}@example.com`,
      password: "Password123!",
      displayName: "Student B",
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
  // 1. Create Conversation
  // --------------------------------------------------------------------------
  describe("POST /api/v1/conversations", () => {
    it("creates a new conversation for authenticated User A", async () => {
      const res = await request(app)
        .post("/api/v1/conversations")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({ title: "Physics Mechanics Study" });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("id");
      expect(res.body.title).toBe("Physics Mechanics Study");
      expect(res.body.createdAt).toBeDefined();

      conversationId = res.body.id;
    });

    it("creates a conversation with default title when omitted", async () => {
      const res = await request(app)
        .post("/api/v1/conversations")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({});

      expect(res.status).toBe(201);
      expect(res.body.title).toBe("New conversation");
    });

    it("rejects request without authentication token", async () => {
      const res = await request(app)
        .post("/api/v1/conversations")
        .send({ title: "Unauthorized Chat" });

      expect(res.status).toBe(401);
    });
  });

  // --------------------------------------------------------------------------
  // 2. List Conversations & User Isolation
  // --------------------------------------------------------------------------
  describe("GET /api/v1/conversations", () => {
    it("returns conversations belonging to User A", async () => {
      const res = await request(app)
        .get("/api/v1/conversations")
        .set("Authorization", `Bearer ${userAToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body.some((c: { id: string }) => c.id === conversationId)).toBe(true);
    });

    it("enforces user isolation: User B cannot see User A's conversations", async () => {
      const res = await request(app)
        .get("/api/v1/conversations")
        .set("Authorization", `Bearer ${userBToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.some((c: { id: string }) => c.id === conversationId)).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Send Message & AI Tutor Workflow
  // --------------------------------------------------------------------------
  describe("POST /api/v1/conversations/:id/messages", () => {
    it("sends a message, invokes AI tutor, and persists both user & assistant messages", async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${conversationId}/messages`)
        .set("Authorization", `Bearer ${userAToken}`)
        .send({
          content: "What is Newton's First Law of Motion?",
          explanationMode: "simple",
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("id");
      expect(res.body.conversationId).toBe(conversationId);
      expect(res.body.role).toBe("assistant");
      expect(res.body.content).toBeDefined();
      expect(res.body.content.length).toBeGreaterThan(0);
      expect(res.body.inputTokens).toBeGreaterThan(0);
      expect(res.body.outputTokens).toBeGreaterThan(0);

      // Verify that database contains both USER and ASSISTANT messages
      const dbMessages = await prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: "asc" },
      });

      expect(dbMessages.length).toBe(2);
      expect(dbMessages[0].role).toBe("USER");
      expect(dbMessages[0].content).toBe("What is Newton's First Law of Motion?");
      expect(dbMessages[1].role).toBe("ASSISTANT");

      // Verify AIUsage record was persisted for tracking
      const usage = await prisma.aIUsage.findFirst({
        where: { userId: userAId, feature: "TUTOR_CHAT" },
      });
      expect(usage).not.toBeNull();
      expect(usage?.status).toBe("SUCCESS");
    });

    it("guards against duplicate message submissions in rapid succession", async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${conversationId}/messages`)
        .set("Authorization", `Bearer ${userAToken}`)
        .send({
          content: "What is Newton's First Law of Motion?",
          explanationMode: "simple",
        });

      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe("RATE_LIMIT_EXCEEDED");
      expect(res.body.error.message).toContain("Duplicate message detected");
    });

    it("rejects empty message content with validation error", async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${conversationId}/messages`)
        .set("Authorization", `Bearer ${userAToken}`)
        .send({ content: "   " });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  // --------------------------------------------------------------------------
  // 4. Retrieve Messages
  // --------------------------------------------------------------------------
  describe("GET /api/v1/conversations/:id/messages", () => {
    it("returns messages in stable chronological order", async () => {
      const res = await request(app)
        .get(`/api/v1/conversations/${conversationId}/messages`)
        .set("Authorization", `Bearer ${userAToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
      expect(res.body[0].role).toBe("user");
      expect(res.body[1].role).toBe("assistant");
    });
  });

  // --------------------------------------------------------------------------
  // 5. Negative Authorization: Cross-User Access Denial
  // --------------------------------------------------------------------------
  describe("Cross-User Authorization Protection", () => {
    it("denies User B reading User A's messages (returns 404)", async () => {
      const res = await request(app)
        .get(`/api/v1/conversations/${conversationId}/messages`)
        .set("Authorization", `Bearer ${userBToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("denies User B sending messages to User A's conversation", async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${conversationId}/messages`)
        .set("Authorization", `Bearer ${userBToken}`)
        .send({ content: "Sneaky unauthorized injection" });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("denies User B renaming User A's conversation", async () => {
      const res = await request(app)
        .patch(`/api/v1/conversations/${conversationId}`)
        .set("Authorization", `Bearer ${userBToken}`)
        .send({ title: "Hacked title" });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("denies User B deleting User A's conversation", async () => {
      const res = await request(app)
        .delete(`/api/v1/conversations/${conversationId}`)
        .set("Authorization", `Bearer ${userBToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });

  // --------------------------------------------------------------------------
  // 6. Rename & Delete Conversation
  // --------------------------------------------------------------------------
  describe("Conversation Lifecycle: Rename and Delete", () => {
    it("renames conversation successfully for owner User A", async () => {
      const res = await request(app)
        .patch(`/api/v1/conversations/${conversationId}`)
        .set("Authorization", `Bearer ${userAToken}`)
        .send({ title: "Updated Physics Review" });

      expect(res.status).toBe(200);
      expect(res.body.title).toBe("Updated Physics Review");
    });

    it("soft-deletes conversation successfully for owner User A", async () => {
      const res = await request(app)
        .delete(`/api/v1/conversations/${conversationId}`)
        .set("Authorization", `Bearer ${userAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(true);

      // Verify conversation no longer appears in GET /api/v1/conversations
      const listRes = await request(app)
        .get("/api/v1/conversations")
        .set("Authorization", `Bearer ${userAToken}`);

      expect(listRes.body.some((c: { id: string }) => c.id === conversationId)).toBe(false);

      // Verify messages endpoint returns 404 for deleted conversation
      const msgRes = await request(app)
        .get(`/api/v1/conversations/${conversationId}/messages`)
        .set("Authorization", `Bearer ${userAToken}`);

      expect(msgRes.status).toBe(404);
    });
  });
});
