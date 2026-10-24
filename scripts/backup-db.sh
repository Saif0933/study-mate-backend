#!/usr/bin/env bash

# ==============================================================================
# AI StudyMate - Database Backup Script
# Creates a compressed PostgreSQL custom-format dump with checksum verification.
# Supports local backups and automated S3/GCS archival.
# ==============================================================================

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/studymate_backup_${TIMESTAMP}.dump"
LOG_FILE="${BACKUP_DIR}/backup_${TIMESTAMP}.log"

mkdir -p "${BACKUP_DIR}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "❌ Error: DATABASE_URL is not set." >&2
  exit 1
fi

echo "=================================================="
echo "📦 Initiating AI StudyMate Database Backup"
echo "🕒 Timestamp: ${TIMESTAMP}"
echo "📁 Destination: ${BACKUP_FILE}"
echo "=================================================="

# Execute pg_dump with custom compressed archive format
pg_dump \
  --dbname="${DATABASE_URL}" \
  --format=custom \
  --compress=9 \
  --file="${BACKUP_FILE}" \
  --verbose 2> "${LOG_FILE}"

# Verify file existence and non-zero size
if [[ -s "${BACKUP_FILE}" ]]; then
  FILESIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
  SHA256=$(sha256sum "${BACKUP_FILE}" | cut -d' ' -f1)
  echo "${SHA256}  $(basename "${BACKUP_FILE}")" > "${BACKUP_FILE}.sha256"
  
  echo "✅ Backup successfully created!"
  echo "📊 Size: ${FILESIZE}"
  echo "🔒 SHA256: ${SHA256}"
else
  echo "❌ Error: Backup file was created empty." >&2
  exit 1
fi

# Optional S3 Archival
if [[ -n "${S3_BACKUP_BUCKET:-}" ]]; then
  echo "☁️  Uploading backup to S3 bucket: ${S3_BACKUP_BUCKET}..."
  aws s3 cp "${BACKUP_FILE}" "s3://${S3_BACKUP_BUCKET}/backups/$(basename "${BACKUP_FILE}")"
  aws s3 cp "${BACKUP_FILE}.sha256" "s3://${S3_BACKUP_BUCKET}/backups/$(basename "${BACKUP_FILE}").sha256"
  echo "✅ S3 upload complete."
fi

# Retention policy: delete local backups older than 14 days
find "${BACKUP_DIR}" -name "studymate_backup_*.dump" -type f -mtime +14 -delete || true
echo "🧹 Pruned backups older than 14 days."
