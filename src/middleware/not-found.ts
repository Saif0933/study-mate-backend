import { Request, Response } from "express";

/**
 * 404 Not Found route handler.
 */
export function notFoundHandler(req: Request, res: Response): void {
  const requestId = req.id || "unknown";
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: `Resource not found: ${req.method} ${req.originalUrl}`,
      requestId,
    },
  });
}
