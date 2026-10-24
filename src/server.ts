import http from "http";
import { app } from "./app";
import { validateEnv } from "./config/env";
import { connectDatabase, disconnectDatabase } from "./config/prisma";
import { logger } from "./utils/logger";

async function bootstrap() {
  try {
    // 1. Validate environment configuration strictly before starting
    const env = validateEnv();
    logger.info({ nodeEnv: env.NODE_ENV, port: env.PORT }, "Environment configuration validated");

    // 2. Connect to PostgreSQL via Prisma 7 adapter
    try {
      await connectDatabase();
    } catch (dbErr) {
      logger.warn(
        { err: dbErr instanceof Error ? dbErr.message : String(dbErr) },
        "Database connection attempt failed during startup. Server will continue running in degraded mode."
      );
    }

    // 3. Start HTTP server
    const server = http.createServer(app);

    server.listen(env.PORT, "0.0.0.0", () => {
      logger.info(
        `AI StudyMate Backend running at http://0.0.0.0:${env.PORT} (and http://localhost:${env.PORT}) in ${env.NODE_ENV} mode`
      );
    });

    // 4. Graceful Shutdown
    let isShuttingDown = false;

    const gracefulShutdown = async (signal: string) => {
      if (isShuttingDown) return;
      isShuttingDown = true;

      logger.info({ signal }, "Received shutdown signal. Commencing graceful shutdown...");

      // Set timeout to force shutdown if hanging
      const forceExitTimeout = setTimeout(() => {
        logger.error("Forced exit due to graceful shutdown timeout");
        process.exit(1);
      }, 10000);

      try {
        await new Promise<void>((resolve, reject) => {
          server.close((err) => {
            if (err) return reject(err);
            resolve();
          });
        });
        logger.info("HTTP server closed to new connections");

        await disconnectDatabase();
        clearTimeout(forceExitTimeout);
        logger.info("Graceful shutdown completed successfully");
        process.exit(0);
      } catch (err) {
        clearTimeout(forceExitTimeout);
        logger.error({ err }, "Error encountered during graceful shutdown");
        process.exit(1);
      }
    };

    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));

    process.on("unhandledRejection", (reason) => {
      logger.error({ reason }, "Unhandled Promise Rejection");
    });

    process.on("uncaughtException", (err) => {
      logger.fatal({ err }, "Uncaught Exception thrown");
      process.exit(1);
    });
  } catch (startupError) {
    // Fail safely and clearly without leaking credentials
    const message = startupError instanceof Error ? startupError.message : String(startupError);
    console.error(message);
    process.exit(1);
  }
}

// Only bootstrap directly if not running within a test suite
if (process.env["NODE_ENV"] !== "test") {
  bootstrap();
}
