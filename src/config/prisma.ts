import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { getEnv } from "./env";
import { logger } from "../utils/logger";

let pool: Pool | null = null;
let prismaInstance: PrismaClient | null = null;

/**
 * Returns or initializes the shared PostgreSQL connection pool.
 */
export function getDbPool(): Pool {
  if (!pool) {
    const env = getEnv();
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on("error", (err) => {
      logger.error({ err: err.message }, "Unexpected error on idle PostgreSQL client");
    });
  }
  return pool;
}

/**
 * Returns or initializes the PrismaClient instance configured with the PostgreSQL driver adapter.
 */
export function getPrismaClient(): PrismaClient {
  if (!prismaInstance) {
    const dbPool = getDbPool();
    const adapter = new PrismaPg(dbPool);
    const env = getEnv();

    prismaInstance = new PrismaClient({
      adapter,
      log: env.LOG_LEVEL === "debug" ? ["query", "info", "warn", "error"] : ["error"],
    });
  }
  return prismaInstance;
}

export const prisma = getPrismaClient();

/**
 * Verifies database connectivity at startup.
 */
export async function connectDatabase(): Promise<void> {
  const client = getPrismaClient();
  try {
    await client.$connect();
    // Test connectivity using raw ping
    const dbPool = getDbPool();
    await dbPool.query("SELECT 1 AS alive");
    logger.info("Successfully connected to PostgreSQL database via Prisma 7 adapter");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, "Failed to connect to PostgreSQL database");
    throw error;
  }
}

/**
 * Gracefully disconnects Prisma and the connection pool.
 */
export async function disconnectDatabase(): Promise<void> {
  try {
    if (prismaInstance) {
      await prismaInstance.$disconnect();
      logger.info("Prisma client disconnected");
    }
    if (pool) {
      await pool.end();
      logger.info("PostgreSQL connection pool closed");
      pool = null;
      prismaInstance = null;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, "Error during database disconnection");
  }
}

/**
 * Health check function for database connectivity.
 * Crucially: NEVER exposes connection strings, credentials, or internal connection parameters.
 */
export async function checkDatabaseHealth(): Promise<{
  connected: boolean;
  latencyMs?: number;
  error?: string;
}> {
  const start = Date.now();
  try {
    const dbPool = getDbPool();
    await dbPool.query("SELECT 1 AS alive");
    return {
      connected: true,
      latencyMs: Date.now() - start,
    };
  } catch {
    return {
      connected: false,
      latencyMs: Date.now() - start,
      error: "Database connectivity check failed",
    };
  }
}
