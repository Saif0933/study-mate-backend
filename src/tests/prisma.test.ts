import { describe, it, expect, afterAll } from "vitest";
import {
  getPrismaClient,
  getDbPool,
  checkDatabaseHealth,
  disconnectDatabase,
} from "../config/prisma";

describe("Prisma 7 & PostgreSQL Connectivity", () => {
  afterAll(async () => {
    await disconnectDatabase();
  });

  it("initializes PrismaClient with PostgreSQL driver adapter", () => {
    const client = getPrismaClient();
    expect(client).toBeDefined();
    expect(typeof client.$connect).toBe("function");
    expect(typeof client.$disconnect).toBe("function");
    expect(client.user).toBeDefined();
    expect(client.document).toBeDefined();
    expect(client.quiz).toBeDefined();
    expect(client.studyPlan).toBeDefined();
  });

  it("initializes a valid pg.Pool instance with configured pool limits", () => {
    const pool = getDbPool();
    expect(pool).toBeDefined();
    expect(typeof pool.query).toBe("function");
  });

  it("checkDatabaseHealth reports connected status with latencyMs", async () => {
    const health = await checkDatabaseHealth();
    expect(health.connected).toBe(true);
    expect(typeof health.latencyMs).toBe("number");
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    expect(health.error).toBeUndefined();
  });
});
