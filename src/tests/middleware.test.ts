import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import { z } from "zod";
import { createApp } from "../app";
import { requestIdMiddleware } from "../middleware/request-id";
import { errorHandler } from "../middleware/error-handler";
import { notFoundHandler } from "../middleware/not-found";
import {
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
} from "../utils/errors";
import { disconnectDatabase } from "../config/prisma";

describe("Middleware & Central Error Handling", () => {
  const mainApp = createApp();

  afterAll(async () => {
    await disconnectDatabase();
  });

  it("returns 404 with standard envelope for unknown routes", async () => {
    const res = await request(mainApp).get("/non-existent-endpoint");

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toHaveProperty("code", "NOT_FOUND");
    expect(res.body.error.message).toContain("GET /non-existent-endpoint");
    expect(res.body.error).toHaveProperty("requestId");
  });

  it("propagates client supplied X-Request-Id header", async () => {
    const clientReqId = "custom-client-trace-12345";
    const res = await request(mainApp)
      .get("/health")
      .set("X-Request-Id", clientReqId);

    expect(res.headers["x-request-id"]).toBe(clientReqId);
  });

  describe("Custom Error Handling in Central Error Handler", () => {
    const testApp = express();
    testApp.use(express.json());
    testApp.use(requestIdMiddleware);

    testApp.get("/test/bad-request", () => {
      throw new BadRequestError("Invalid parameter passed");
    });

    testApp.get("/test/unauthorized", () => {
      throw new UnauthorizedError("Valid token required");
    });

    testApp.get("/test/forbidden", () => {
      throw new ForbiddenError("Insufficient permissions");
    });

    testApp.get("/test/not-found", () => {
      throw new NotFoundError("Document not found");
    });

    testApp.get("/test/conflict", () => {
      throw new ConflictError("Email already in use");
    });

    testApp.post("/test/zod-validation", (req) => {
      const schema = z.object({
        email: z.string().email(),
        count: z.number().positive(),
      });
      schema.parse(req.body);
    });

    testApp.get("/test/unhandled", () => {
      throw new Error("Simulated unhandled internal exception");
    });

    testApp.use(notFoundHandler);
    testApp.use(errorHandler);

    it("formats BadRequestError as 400 BAD_REQUEST", async () => {
      const res = await request(testApp).get("/test/bad-request");
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("BAD_REQUEST");
      expect(res.body.error.message).toBe("Invalid parameter passed");
      expect(res.body.error.requestId).toBeDefined();
    });

    it("formats UnauthorizedError as 401 UNAUTHORIZED", async () => {
      const res = await request(testApp).get("/test/unauthorized");
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHORIZED");
      expect(res.body.error.message).toBe("Valid token required");
    });

    it("formats ForbiddenError as 403 FORBIDDEN", async () => {
      const res = await request(testApp).get("/test/forbidden");
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });

    it("formats NotFoundError as 404 NOT_FOUND", async () => {
      const res = await request(testApp).get("/test/not-found");
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("formats ConflictError as 409 CONFLICT", async () => {
      const res = await request(testApp).get("/test/conflict");
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("CONFLICT");
    });

    it("formats ZodError as 400 VALIDATION_ERROR with field details", async () => {
      const res = await request(testApp)
        .post("/test/zod-validation")
        .send({ email: "invalid-email", count: -5 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.details).toBeInstanceOf(Array);
      expect(res.body.error.details.length).toBeGreaterThanOrEqual(2);
    });

    it("formats unhandled error as 500 INTERNAL_SERVER_ERROR", async () => {
      const res = await request(testApp).get("/test/unhandled");
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe("INTERNAL_SERVER_ERROR");
      expect(res.body.error.requestId).toBeDefined();
    });
  });
});
