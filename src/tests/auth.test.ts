import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { prisma, disconnectDatabase } from "../config/prisma";
import { UserStatus } from "../generated/prisma/enums";

describe("Phase 2: Authentication & User Lifecycle", () => {
  const app = createApp();
  const testRunId = Date.now();
  const testEmail = `test.user.${testRunId}@example.com`;
  const testPassword = "SecurePassword123!";
  const testDisplayName = "Test Engineer";

  let createdUserId = "";
  let authToken = "";
  let currentRefreshToken = "";

  afterAll(async () => {
    // Clean up test data created during test run
    try {
      if (createdUserId) {
        await prisma.user.delete({ where: { id: createdUserId } }).catch(() => {});
      }
    } finally {
      await disconnectDatabase();
    }
  });

  // --------------------------------------------------------------------------
  // 1. Registration
  // --------------------------------------------------------------------------
  describe("POST /api/v1/auth/register", () => {
    it("successfully registers a new user with normalized email", async () => {
      // Intentionally uppercase and untrimmed email to test normalization
      const rawEmail = `  TEST.USER.${testRunId}@EXAMPLE.COM  `;

      const res = await request(app)
        .post("/api/v1/auth/register")
        .send({
          email: rawEmail,
          password: testPassword,
          displayName: testDisplayName,
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("token");
      expect(res.body).toHaveProperty("accessToken");
      expect(res.body).toHaveProperty("refreshToken");
      expect(res.body).toHaveProperty("user");

      const user = res.body.user;
      expect(user.email).toBe(testEmail.toLowerCase());
      expect(user.displayName).toBe(testDisplayName);
      expect(user.status).toBe("ACTIVE");
      expect(user.id).toBeDefined();

      createdUserId = user.id;
      authToken = res.body.token;
      currentRefreshToken = res.body.refreshToken;

      // Ensure no password or hash is leaked in API response
      const responseStr = JSON.stringify(res.body);
      expect(responseStr).not.toContain(testPassword);
      expect(responseStr).not.toContain("passwordHash");

      // Verify in PostgreSQL that password is truly hashed, never plaintext
      const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
      expect(dbUser).not.toBeNull();
      expect(dbUser?.passwordHash).not.toBe(testPassword);
      expect(dbUser?.passwordHash.startsWith("$2")).toBe(true);
    });

    it("rejects duplicate email with 409 Conflict", async () => {
      const res = await request(app)
        .post("/api/v1/auth/register")
        .send({
          email: testEmail.toUpperCase(),
          password: testPassword,
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("CONFLICT");
      expect(res.body.error.message).toContain("already exists");
    });

    it("rejects registration with short password (< 8 chars)", async () => {
      const res = await request(app)
        .post("/api/v1/auth/register")
        .send({
          email: `short.${testRunId}@example.com`,
          password: "short",
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(JSON.stringify(res.body.error.details)).toContain("8 characters");
    });

    it("rejects registration with invalid email", async () => {
      const res = await request(app)
        .post("/api/v1/auth/register")
        .send({
          email: "not-an-email",
          password: testPassword,
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  // --------------------------------------------------------------------------
  // 2. Login & Session
  // --------------------------------------------------------------------------
  describe("POST /api/v1/auth/login", () => {
    it("successfully logs in with valid credentials", async () => {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({
          email: testEmail,
          password: testPassword,
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("token");
      expect(res.body.user.id).toBe(createdUserId);
      expect(res.body.user.email).toBe(testEmail);

      authToken = res.body.token;
      currentRefreshToken = res.body.refreshToken;
    });

    it("supports /api/v1/auth/session alias for frontend compatibility", async () => {
      const res = await request(app)
        .post("/api/v1/auth/session")
        .send({
          email: testEmail,
          password: testPassword,
        });

      expect(res.status).toBe(200);
      expect(res.body.user.id).toBe(createdUserId);
    });

    it("rejects login with wrong password without leaking account existence", async () => {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({
          email: testEmail,
          password: "WrongPassword999!",
        });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHORIZED");
      expect(res.body.error.message).toBe("Invalid email or password");
    });

    it("rejects login for non-existent email with identical generic error", async () => {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({
          email: `nobody.${testRunId}@example.com`,
          password: testPassword,
        });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHORIZED");
      expect(res.body.error.message).toBe("Invalid email or password");
    });
  });

  // --------------------------------------------------------------------------
  // 3. Protected Route: GET /api/v1/me
  // --------------------------------------------------------------------------
  describe("GET /api/v1/me (Protected Route)", () => {
    it("returns authenticated user profile when Bearer token is provided", async () => {
      const res = await request(app)
        .get("/api/v1/me")
        .set("Authorization", `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(createdUserId);
      expect(res.body.email).toBe(testEmail);
      expect(res.body.displayName).toBe(testDisplayName);
      expect(res.body.status).toBe("ACTIVE");
      expect(res.body).not.toHaveProperty("passwordHash");
    });

    it("supports GET /api/v1/auth/me alias", async () => {
      const res = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(createdUserId);
    });

    it("rejects request without Authorization header", async () => {
      const res = await request(app).get("/api/v1/me");

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHORIZED");
    });

    it("rejects request with invalid token", async () => {
      const res = await request(app)
        .get("/api/v1/me")
        .set("Authorization", "Bearer invalid-tampered-token");

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHORIZED");
    });
  });

  // --------------------------------------------------------------------------
  // 4. Refresh Token Rotation & Reuse Detection
  // --------------------------------------------------------------------------
  describe("POST /api/v1/auth/refresh (Token Rotation & Reuse Detection)", () => {
    let rotatedRefreshToken = "";

    it("refreshes session and rotates refresh token", async () => {
      const res = await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: currentRefreshToken });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("accessToken");
      expect(res.body).toHaveProperty("refreshToken");
      expect(res.body.refreshToken).not.toBe(currentRefreshToken);

      rotatedRefreshToken = res.body.refreshToken;
    });

    it("detects reuse attack when old refresh token is reused", async () => {
      // Attacker or replay attempts to reuse the already-rotated token
      const res = await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: currentRefreshToken });

      expect(res.status).toBe(401);
      expect(res.body.error.message).toContain("Token reuse detected");

      // Verify that even the newly issued rotated token was invalidated due to reuse detection
      const followUpRes = await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: rotatedRefreshToken });

      expect(followUpRes.status).toBe(401);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Password Reset Workflow
  // --------------------------------------------------------------------------
  describe("Password Reset Workflow", () => {
    let resetToken = "";
    const newPassword = "BrandNewPassword456!";

    it("POST /api/v1/auth/forgot-password returns instructions and generates token", async () => {
      const res = await request(app)
        .post("/api/v1/auth/forgot-password")
        .send({ email: testEmail });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain("instructions have been sent");
      expect(res.body.resetToken).toBeDefined();

      resetToken = res.body.resetToken;
    });

    it("POST /api/v1/auth/forgot-password returns same generic message for unknown email", async () => {
      const res = await request(app)
        .post("/api/v1/auth/forgot-password")
        .send({ email: "does.not.exist@example.com" });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain("instructions have been sent");
      // Does not leak reset token for non-existent account
      expect(res.body.resetToken).toBeUndefined();
    });

    it("POST /api/v1/auth/reset-password successfully resets password", async () => {
      const res = await request(app)
        .post("/api/v1/auth/reset-password")
        .send({
          token: resetToken,
          password: newPassword,
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain("successfully reset");

      // Verify that new password can now log in
      const loginRes = await request(app)
        .post("/api/v1/auth/login")
        .send({
          email: testEmail,
          password: newPassword,
        });

      expect(loginRes.status).toBe(200);
      expect(loginRes.body.user.id).toBe(createdUserId);

      // Verify old password is no longer accepted
      const oldLoginRes = await request(app)
        .post("/api/v1/auth/login")
        .send({
          email: testEmail,
          password: testPassword,
        });

      expect(oldLoginRes.status).toBe(401);
    });

    it("prevents reuse of the same password reset token", async () => {
      const res = await request(app)
        .post("/api/v1/auth/reset-password")
        .send({
          token: resetToken,
          password: "AnotherPassword789!",
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("BAD_REQUEST");
      expect(res.body.error.message).toContain("Invalid or expired");
    });
  });

  // --------------------------------------------------------------------------
  // 6. Account Status Checks
  // --------------------------------------------------------------------------
  describe("Account Status Checks", () => {
    it("rejects login and protected routes when account is DISABLED", async () => {
      // Set status to DISABLED
      await prisma.user.update({
        where: { id: createdUserId },
        data: { status: UserStatus.DISABLED },
      });

      const loginRes = await request(app)
        .post("/api/v1/auth/login")
        .send({
          email: testEmail,
          password: "BrandNewPassword456!",
        });

      expect(loginRes.status).toBe(403);
      expect(loginRes.body.error.code).toBe("FORBIDDEN");

      const meRes = await request(app)
        .get("/api/v1/me")
        .set("Authorization", `Bearer ${authToken}`);

      expect(meRes.status).toBe(403);
      expect(meRes.body.error.code).toBe("FORBIDDEN");

      // Restore status to ACTIVE for subsequent tests
      await prisma.user.update({
        where: { id: createdUserId },
        data: { status: UserStatus.ACTIVE },
      });
    });
  });

  // --------------------------------------------------------------------------
  // 7. Logout & Account Deletion
  // --------------------------------------------------------------------------
  describe("Logout and Account Deletion", () => {
    it("POST /api/v1/auth/logout succeeds", async () => {
      const res = await request(app)
        .post("/api/v1/auth/logout")
        .send({ refreshToken: "some-token" });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain("Logged out");
    });

    it("DELETE /api/v1/me schedules account deletion", async () => {
      // Re-login to get fresh token
      const loginRes = await request(app)
        .post("/api/v1/auth/login")
        .send({
          email: testEmail,
          password: "BrandNewPassword456!",
        });

      const activeToken = loginRes.body.token;

      const deleteRes = await request(app)
        .delete("/api/v1/me")
        .set("Authorization", `Bearer ${activeToken}`);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.message).toContain("deletion");

      // Verify user status is now DELETION_PENDING in database
      const dbUser = await prisma.user.findUnique({ where: { id: createdUserId } });
      expect(dbUser?.status).toBe(UserStatus.DELETION_PENDING);
      expect(dbUser?.deletedAt).not.toBeNull();
    });
  });
});
