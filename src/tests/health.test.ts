import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { disconnectDatabase } from "../config/prisma";

describe("Health and Security Endpoints", () => {
  const app = createApp();

  afterAll(async () => {
    await disconnectDatabase();
  });

  it("GET /health returns 200 with service status and no leaked secrets", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("status", "ok");
    expect(res.body).toHaveProperty("timestamp");
    expect(res.body).toHaveProperty("environment");
    expect(res.body.services).toHaveProperty("database");
    expect(res.body.services.database.status).toBe("connected");

    // CRITICAL: Ensure NO credentials, database URLs, passwords, or hosts are leaked
    const responseString = JSON.stringify(res.body);
    expect(responseString).not.toMatch(/postgres:/i);
    expect(responseString).not.toMatch(/password/i);
    expect(responseString).not.toMatch(/postgresql:\/\//i);
    expect(responseString).not.toMatch(/localhost:5432/i);
    expect(responseString).not.toMatch(/studymatedb/i);
  });

  it("GET /api/v1/health returns matching health status", async () => {
    const res = await request(app).get("/api/v1/health");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("status", "ok");
    expect(res.body.services.database.status).toBe("connected");
  });

  it("GET / preserves existing root response", async () => {
    const res = await request(app).get("/");

    expect(res.status).toBe(200);
    expect(res.text).toBe("Hello, TypeScript + Node.js + Express!");
  });

  it("includes secure HTTP headers (Helmet)", async () => {
    const res = await request(app).get("/health");

    expect(res.headers).toHaveProperty("x-content-type-options", "nosniff");
    expect(res.headers).toHaveProperty("x-dns-prefetch-control", "off");
    expect(res.headers).toHaveProperty("x-frame-options", "SAMEORIGIN");
  });

  it("GET /health/ready returns 200 ready when database and storage are accessible", async () => {
    const res = await request(app).get("/health/ready");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("status", "ready");
    expect(res.body.checks).toHaveProperty("database", "ok");
    expect(res.body.checks).toHaveProperty("storage", "ok");
  });

  it("GET /health/metrics exposes operational telemetry and AI usage without secret leakage", async () => {
    const res = await request(app).get("/health/metrics");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("process");
    expect(res.body.process).toHaveProperty("memory");
    expect(res.body.process.memory).toHaveProperty("rssMb");
    expect(res.body).toHaveProperty("database");
    expect(res.body.database.status).toBe("connected");
    expect(res.body).toHaveProperty("aiTelemetry");
    expect(res.body.aiTelemetry).toHaveProperty("totalRequests");
    expect(res.body.aiTelemetry).toHaveProperty("costAlertThresholdUsd");

    // Ensure secrets are not in metrics
    const str = JSON.stringify(res.body);
    expect(str).not.toMatch(/postgres:/i);
    expect(str).not.toMatch(/secret/i);
  });
});
