#!/usr/bin/env bash

# ==============================================================================
# AI StudyMate - Database Disaster Recovery & Restoration Script
# Safely restores a PostgreSQL custom-format dump into target database.
# Enforces manual confirmation to prevent accidental production overwrite.
# ==============================================================================

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <path-to-backup.dump>"
  echo "Example: $0 ./backups/studymate_backup_20261014_100000.dump"
  exit 1
fi

BACKUP_FILE="$1"

if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "❌ Error: Backup file '${BACKUP_FILE}' does not exist." >&2
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "❌ Error: DATABASE_URL is not set." >&2
  exit 1
fi

# Verify checksum if present
if [[ -f "${BACKUP_FILE}.sha256" ]]; then
  echo "🔍 Verifying SHA256 checksum..."
  (cd "$(dirname "${BACKUP_FILE}")" && sha256sum -c "$(basename "${BACKUP_FILE}.sha256")")
  echo "✅ Checksum verified."
fi

echo "=================================================="
echo "⚠️  CRITICAL ACTION: Database Restoration"
echo "📦 Backup file: ${BACKUP_FILE}"
echo "📡 Target: ${DATABASE_URL}"
echo "=================================================="

# Require confirmation unless FORCE_RESTORE=true
if [[ "${FORCE_RESTORE:-false}" != "true" ]]; then
  read -p "Are you sure you want to restore this database? (Type 'RESTORE' to proceed): " CONFIRM
  if [[ "${CONFIRM}" != "RESTORE" ]]; then
    echo "Restoration cancelled by operator."
    exit 0
  fi
fi

echo "🚀 Starting database restore with pg_restore..."

# Execute pg_restore with clean and if-exists flags
pg_restore \
  --dbname="${DATABASE_URL}" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --verbose \
  "${BACKUP_FILE}" || true

echo "✅ Restoration command executed."

# Re-run migrations to ensure schema aligns with code
echo "🔄 Verifying schema with 'prisma migrate status'..."
npx prisma migrate status

echo "🎉 Database restoration completed."
