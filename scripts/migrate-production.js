#!/usr/bin/env node

/**
 * ==============================================================================
 * AI StudyMate - Controlled Production Migration Script
 * Applies pending migrations via `prisma migrate deploy` without prompts or resets.
 * NEVER resets or destroys databases containing user data.
 * ==============================================================================
 */

const { execSync } = require("child_process");
require("dotenv").config();

function sanitizeDbUrl(url) {
  if (!url) return "<not set>";
  return url.replace(/:([^:@]+)@/, ":****@");
}

async function runProductionMigration() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("❌ FATAL: DATABASE_URL is not set. Cannot run migrations.");
    process.exit(1);
  }

  console.log("==================================================");
  console.log("🚀 Starting controlled production database migration");
  console.log(`📡 Target Database: ${sanitizeDbUrl(dbUrl)}`);
  console.log(`🏷️  Environment: ${process.env.NODE_ENV || "production"}`);
  console.log("==================================================");

  try {
    // 1. Check current migration status first
    console.log("🔍 Checking pending migration status...");
    execSync("npx prisma migrate status", {
      stdio: "inherit",
      env: process.env,
    });

    // 2. Deploy only pending migrations safely (NEVER prompts, NEVER resets)
    console.log("\n📦 Applying pending migrations via 'prisma migrate deploy'...");
    execSync("npx prisma migrate deploy", {
      stdio: "inherit",
      env: process.env,
    });

    // 3. Confirm all migrations are up to date
    console.log("\n✅ Verifying database schema state...");
    execSync("npx prisma migrate status", {
      stdio: "inherit",
      env: process.env,
    });

    console.log("\n🎉 Database migration completed successfully. Database is ready for traffic.");
    process.exit(0);
  } catch (err) {
    console.error("\n❌ FATAL: Migration failed.");
    console.error(err.message || String(err));
    process.exit(1);
  }
}

runProductionMigration();
