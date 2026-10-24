import pinoHttp from "pino-http";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../utils/logger";

export const requestLogger = pinoHttp({
  logger,
  genReqId: (req) => {
    const existing = req.headers["x-request-id"];
    if (typeof existing === "string" && existing.length > 0) {
      return existing;
    }
    const withId = req as unknown as { id?: string };
    if (typeof withId.id === "string" && withId.id.length > 0) {
      return withId.id;
    }
    return uuidv4();
  },
  customLogLevel: (_req, res, err) => {
    if (res.statusCode >= 500 || err) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  autoLogging: {
    ignore: (req) => req.url === "/health" || req.url === "/api/v1/health",
  },
});
