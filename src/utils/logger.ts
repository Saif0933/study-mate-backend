import pino from "pino";

const isTest = process.env["NODE_ENV"] === "test";

export const logger = pino({
  level: isTest ? "silent" : (process.env["LOG_LEVEL"] || "info"),
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "password",
      "passwordHash",
      "token",
      "secret",
      "apiKey",
      "*.password",
      "*.token",
      "*.secret",
    ],
    censor: "[REDACTED]",
  },
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;
