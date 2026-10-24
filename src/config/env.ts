import dotenv from "dotenv";
import { z } from "zod";

// Load environment variables from .env file
dotenv.config();

/**
 * Environment configuration schema.
 * Strict validation ensures server fails safely at startup if mandatory config is missing.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5000),
  DATABASE_URL: z
    .string()
    .min(1, { message: "DATABASE_URL is required" })
    .refine(
      (url) => url.startsWith("postgresql://") || url.startsWith("postgres://"),
      { message: "DATABASE_URL must be a valid PostgreSQL connection string" }
    ),
  CORS_ORIGIN: z.string().default("*"),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"])
    .default("info"),
  REQUEST_BODY_LIMIT: z.string().default("10mb"),
  JWT_SECRET: z
    .string()
    .min(1, { message: "JWT_SECRET is required" })
    .default("development-fallback-secret-minimum-32-chars-long"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  
  // Optional integration credentials
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o"),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  AI_TUTOR_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.7),
  AI_TUTOR_MAX_TOKENS: z.coerce.number().positive().default(1024),
  AI_TUTOR_TIMEOUT_MS: z.coerce.number().positive().default(30000),
  AI_TUTOR_MAX_RETRIES: z.coerce.number().nonnegative().default(2),
  AI_CONTEXT_MAX_MESSAGES: z.coerce.number().positive().default(10),
  REDIS_URL: z.string().optional(),
  
  // Cloudinary configuration (optional in Phase 1)
  CLOUD_NAME: z.string().optional(),
  CLOUD_API_KEY: z.string().optional(),
  CLOUD_API_SECRET: z.string().optional(),
  CLOUD_FOLDER: z.string().default("study-mate"),

  // Phase 4 Document Processing & Storage
  UPLOAD_DIR: z.string().default("uploads/documents"),
  MAX_FILE_SIZE_BYTES: z.coerce.number().positive().default(20 * 1024 * 1024),
  EMBEDDING_DIMENSION: z.coerce.number().positive().default(1536),

  // Phase 7 Usage Quotas & Limits
  AI_DAILY_QUOTA_LIMIT: z.coerce.number().positive().default(50),
  AI_MONTHLY_QUOTA_LIMIT: z.coerce.number().positive().default(500),
  AI_MAX_PROMPT_CHARS: z.coerce.number().positive().default(8000),
  AI_GLOBAL_MONTHLY_COST_LIMIT_USD: z.coerce.number().positive().default(100.0),

  // Operational & Infrastructure
  TRUST_PROXY: z.coerce.boolean().default(false),
  METRICS_AUTH_TOKEN: z.string().optional(),
}).superRefine((data, ctx) => {
  const isProd = data.NODE_ENV === "production" || process.env["NODE_ENV"] === "production";
  if (isProd && data.JWT_SECRET.length < 32) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["JWT_SECRET"],
      message: "JWT_SECRET must be at least 32 characters in production",
    });
  }
  if (isProd && data.CORS_ORIGIN.trim() === "*") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["CORS_ORIGIN"],
      message: "CORS_ORIGIN cannot be '*' wildcard in production. Specify exact allowed origins.",
    });
  }
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validates process.env against the schema.
 * Throws a formatted safe error without leaking raw credential values.
 */
export function validateEnv(customEnv?: Record<string, unknown>): Env {
  const result = envSchema.safeParse(customEnv ?? process.env);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.join(".");
      return ` - ${path}: ${issue.message}`;
    });

    const errorMessage = [
      "==================================================",
      "❌ FATAL CONFIGURATION ERROR: Invalid environment variables",
      ...issues,
      "==================================================",
    ].join("\n");

    throw new Error(errorMessage);
  }

  return result.data;
}

// Cached environment config for application runtime
let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (!cachedEnv) {
    cachedEnv = validateEnv();
  }
  return cachedEnv;
}
