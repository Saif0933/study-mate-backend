import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { AppError } from "../utils/errors";
import { logger } from "../utils/logger";

interface ErrorResponseEnvelope {
  error: {
    code: string;
    message: string;
    details?: Array<{ field?: string; message: string; code?: string }>;
    requestId?: string;
  };
}

/**
 * Central error-handling middleware.
 * Ensures consistent error response envelope and guards against sensitive info leakage.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
): void {
  const requestId = req.id ? String(req.id) : "unknown";

  // 1. Handled Application Errors
  if (err instanceof AppError) {
    if (!err.isOperational) {
      logger.error({ err, requestId }, "Non-operational AppError occurred");
    } else {
      logger.warn({ code: err.code, message: err.message, requestId }, "Operational error handled");
    }

    const response: ErrorResponseEnvelope = {
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        requestId,
      },
    };
    res.status(err.statusCode).json(response);
    return;
  }

  // 2. Zod Validation Errors
  if (err instanceof ZodError) {
    const details = err.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
      code: issue.code,
    }));

    logger.warn({ details, requestId }, "Request validation failed");

    const response: ErrorResponseEnvelope = {
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request payload",
        details,
        requestId,
      },
    };
    res.status(400).json(response);
    return;
  }

  // 3. Body-parser JSON syntax errors
  if (err instanceof SyntaxError && "status" in err && (err as { status?: number }).status === 400) {
    logger.warn({ err: err.message, requestId }, "Malformed JSON payload");
    const response: ErrorResponseEnvelope = {
      error: {
        code: "INVALID_JSON",
        message: "Malformed JSON payload in request body",
        requestId,
      },
    };
    res.status(400).json(response);
    return;
  }

  // 4. Prisma Known Request Errors (e.g., unique constraint, not found)
  if (err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string") {
    const prismaErr = err as { code: string; meta?: Record<string, unknown>; message?: string };
    
    if (prismaErr.code === "P2002") {
      const target = (prismaErr.meta?.["target"] as string[])?.join(", ") || "field";
      logger.warn({ code: prismaErr.code, target, requestId }, "Prisma unique constraint violation");
      const response: ErrorResponseEnvelope = {
        error: {
          code: "CONFLICT",
          message: `A record with this ${target} already exists`,
          requestId,
        },
      };
      res.status(409).json(response);
      return;
    }

    if (prismaErr.code === "P2025") {
      logger.warn({ code: prismaErr.code, requestId }, "Prisma record not found");
      const response: ErrorResponseEnvelope = {
        error: {
          code: "NOT_FOUND",
          message: "Requested database record not found",
          requestId,
        },
      };
      res.status(404).json(response);
      return;
    }
  }

  // 5. Unhandled / Internal Server Errors
  const internalMessage = err instanceof Error ? err.message : String(err);
  logger.error(
    {
      err: internalMessage,
      stack: err instanceof Error ? err.stack : undefined,
      requestId,
      path: req.originalUrl,
      method: req.method,
    },
    "Unhandled internal server error"
  );

  const response: ErrorResponseEnvelope = {
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message:
        process.env["NODE_ENV"] === "production"
          ? "An unexpected error occurred. Please try again later."
          : internalMessage || "An unexpected error occurred",
      requestId,
    },
  };

  res.status(500).json(response);
}
