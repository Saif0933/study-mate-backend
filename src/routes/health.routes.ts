import { Router, Request, Response } from "express";
import fs from "fs";
import { checkDatabaseHealth, prisma } from "../config/prisma";
import { getEnv } from "../config/env";

export const healthRouter = Router();

/**
 * Liveness Probe: GET /health
 * Fast check indicating process is alive and responsive.
 */
healthRouter.get("/", async (_req: Request, res: Response) => {
  const env = getEnv();
  const dbHealth = await checkDatabaseHealth();

  const isHealthy = dbHealth.connected;
  const status = isHealthy ? "ok" : "degraded";

  const payload = {
    status,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    environment: env.NODE_ENV,
    services: {
      database: {
        status: dbHealth.connected ? "connected" : "disconnected",
        ...(dbHealth.latencyMs !== undefined ? { latencyMs: dbHealth.latencyMs } : {}),
      },
    },
  };

  res.status(isHealthy ? 200 : 503).json(payload);
});

/**
 * Readiness Probe: GET /health/ready
 * Strict verification for container orchestrators (K8s, ECS, Fly.io, Render)
 * confirming application is ready to accept user traffic.
 */
healthRouter.get("/ready", async (_req: Request, res: Response) => {
  const env = getEnv();
  const dbHealth = await checkDatabaseHealth();

  // Check upload directory accessibility
  let storageWritable = false;
  try {
    const uploadDir = env.UPLOAD_DIR;
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    const testFile = `${uploadDir}/.health_check_${Date.now()}`;
    fs.writeFileSync(testFile, "ok");
    fs.unlinkSync(testFile);
    storageWritable = true;
  } catch {
    storageWritable = false;
  }

  const isReady = dbHealth.connected && storageWritable;

  res.status(isReady ? 200 : 503).json({
    status: isReady ? "ready" : "not_ready",
    timestamp: new Date().toISOString(),
    checks: {
      database: dbHealth.connected ? "ok" : "failed",
      storage: storageWritable ? "ok" : "failed",
    },
  });
});

/**
 * Operational Telemetry & Metrics: GET /health/metrics
 * Exposes system telemetry, database health, AI provider error rate & costs.
 */
healthRouter.get("/metrics", async (req: Request, res: Response) => {
  const env = getEnv();

  // If METRICS_AUTH_TOKEN is set in production, require matching token
  if (env.METRICS_AUTH_TOKEN) {
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const queryToken = typeof req.query["token"] === "string" ? req.query["token"] : null;
    const provided = bearerToken || queryToken;

    if (!provided || provided !== env.METRICS_AUTH_TOKEN) {
      res.status(401).json({ error: "Unauthorized metrics access" });
      return;
    }
  }

  const dbHealth = await checkDatabaseHealth();
  const mem = process.memoryUsage();

  // Aggregate AI telemetry if database is connected
  let aiStats = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    rateLimitedRequests: 0,
    totalCostUsd: 0,
  };

  if (dbHealth.connected) {
    try {
      const [total, successCount, failCount, rateLimitCount, costAgg] = await Promise.all([
        prisma.aIUsage.count(),
        prisma.aIUsage.count({ where: { status: "SUCCESS" } }),
        prisma.aIUsage.count({ where: { status: "FAILED" } }),
        prisma.aIUsage.count({ where: { status: "RATE_LIMITED" } }),
        prisma.aIUsage.aggregate({ _sum: { estimatedCost: true } }),
      ]);

      aiStats = {
        totalRequests: total,
        successfulRequests: successCount,
        failedRequests: failCount,
        rateLimitedRequests: rateLimitCount,
        totalCostUsd: Number(costAgg._sum.estimatedCost ?? 0),
      };
    } catch {
      // Degrade telemetry safely without crashing
    }
  }

  res.status(200).json({
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
    uptimeSeconds: Math.floor(process.uptime()),
    process: {
      nodeVersion: process.version,
      pid: process.pid,
      memory: {
        rssMb: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
        heapTotalMb: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
        heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
      },
    },
    database: {
      status: dbHealth.connected ? "connected" : "disconnected",
      latencyMs: dbHealth.latencyMs ?? null,
    },
    aiTelemetry: {
      ...aiStats,
      costAlertThresholdUsd: env.AI_GLOBAL_MONTHLY_COST_LIMIT_USD,
      costExceeded: aiStats.totalCostUsd >= env.AI_GLOBAL_MONTHLY_COST_LIMIT_USD,
      dailyQuotaLimit: env.AI_DAILY_QUOTA_LIMIT,
      monthlyQuotaLimit: env.AI_MONTHLY_QUOTA_LIMIT,
      modelId: env.OPENAI_MODEL,
      embeddingModelId: env.OPENAI_EMBEDDING_MODEL,
    },
  });
});

