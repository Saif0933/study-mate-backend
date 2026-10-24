import express, { Express } from "express";
import helmet from "helmet";
import cors from "cors";
import { getEnv } from "./config/env";
import { requestIdMiddleware } from "./middleware/request-id";
import { requestLogger } from "./middleware/request-logger";
import { notFoundHandler } from "./middleware/not-found";
import { errorHandler } from "./middleware/error-handler";
import { healthRouter } from "./routes/health.routes";
import { apiRouter } from "./routes/index";

export function createApp(): Express {
  const env = getEnv();
  const app = express();

  // 1. Reverse proxy trust configuration for production/load balancers
  if (env.TRUST_PROXY || env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
  }

  // 2. Secure HTTP headers
  app.use(helmet());

  // 2. CORS Allowlisting
  const corsOrigin =
    env.CORS_ORIGIN === "*"
      ? "*"
      : env.CORS_ORIGIN.split(",").map((origin) => origin.trim());

  app.use(
    cors({
      origin: corsOrigin,
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
    })
  );

  // 3. Request body limits
  app.use(express.json({ limit: env.REQUEST_BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: env.REQUEST_BODY_LIMIT }));

  // 4. Request ID / Correlation tracking
  app.use(requestIdMiddleware);

  // 5. Request logging
  app.use(requestLogger);

  // 6. Base & Health Endpoints
  // Preserving original root endpoint
  app.get("/", (_req, res) => {
    res.send("Hello, TypeScript + Node.js + Express!");
  });

  // Dedicated top-level and v1 health endpoints
  app.use("/health", healthRouter);
  app.use("/api/v1", apiRouter);

  // 7. 404 handler
  app.use(notFoundHandler);

  // 8. Central Error handler
  app.use(errorHandler);

  return app;
}

export const app = createApp();
