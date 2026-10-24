import rateLimit from "express-rate-limit";
import { RateLimitError } from "../utils/errors";

const isTest = process.env["NODE_ENV"] === "test";

/**
 * Rate limiter for sensitive authentication endpoints (login, register, refresh).
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isTest ? 1000 : 30, // 30 attempts per IP per 15 mins
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => {
    next(new RateLimitError("Too many authentication attempts. Please try again in 15 minutes."));
  },
});

/**
 * Stricter rate limiter for password reset requests to mitigate abuse.
 */
export const forgotPasswordRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isTest ? 1000 : 10, // 10 attempts per IP per 15 mins
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => {
    next(new RateLimitError("Too many password reset attempts. Please try again in 15 minutes."));
  },
});

/**
 * Rate limiter for conversation messages to prevent spam and unbounded LLM calls.
 */
export const messageRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: isTest ? 1000 : 30, // 30 messages per minute
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => {
    next(new RateLimitError("Too many message requests. Please wait a moment before sending more messages."));
  },
});

