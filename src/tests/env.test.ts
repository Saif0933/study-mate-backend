import { describe, it, expect } from "vitest";
import { validateEnv } from "../config/env";

describe("Environment Validation (src/config/env.ts)", () => {
  it("successfully parses valid environment variables", () => {
    const validConfig = {
      NODE_ENV: "test",
      PORT: "5000",
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/studymatedb",
      CORS_ORIGIN: "http://localhost:3000",
      LOG_LEVEL: "info",
    };

    const env = validateEnv(validConfig);
    expect(env.NODE_ENV).toBe("test");
    expect(env.PORT).toBe(5000);
    expect(env.DATABASE_URL).toBe(validConfig.DATABASE_URL);
    expect(env.CORS_ORIGIN).toBe("http://localhost:3000");
    expect(env.REQUEST_BODY_LIMIT).toBe("10mb");
  });

  it("throws a clear startup error when DATABASE_URL is missing", () => {
    const invalidConfig = {
      NODE_ENV: "development",
      PORT: "5000",
    };

    expect(() => validateEnv(invalidConfig)).toThrow(
      /FATAL CONFIGURATION ERROR/
    );
  });

  it("throws an error when DATABASE_URL is not a PostgreSQL connection string", () => {
    const invalidConfig = {
      DATABASE_URL: "mysql://user:pass@localhost:3306/db",
    };

    expect(() => validateEnv(invalidConfig)).toThrow(
      /must be a valid PostgreSQL connection string/
    );
  });

  it("throws an error when PORT is invalid", () => {
    const invalidConfig = {
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/studymatedb",
      PORT: "-10",
    };

    expect(() => validateEnv(invalidConfig)).toThrow(
      /FATAL CONFIGURATION ERROR/
    );
  });

  it("applies sensible defaults when optional variables are omitted", () => {
    const minimalConfig = {
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/studymatedb",
    };

    const env = validateEnv(minimalConfig);
    expect(env.NODE_ENV).toBe("development");
    expect(env.PORT).toBe(5000);
    expect(env.CORS_ORIGIN).toBe("*");
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.REQUEST_BODY_LIMIT).toBe("10mb");
  });

  it("rejects wildcard CORS_ORIGIN in production environment", () => {
    const prodConfig = {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/studymatedb",
      JWT_SECRET: "this-is-a-valid-production-secret-with-at-least-32-chars",
      CORS_ORIGIN: "*",
    };

    expect(() => validateEnv(prodConfig)).toThrow(
      /CORS_ORIGIN cannot be '\*' wildcard in production/
    );
  });
});
