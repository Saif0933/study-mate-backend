# AI StudyMate — Database Operations & Disaster Recovery Runbook

This runbook outlines standard operating procedures for managing, migrating, backing up, and restoring the **AI StudyMate** production PostgreSQL database with the `pgvector` extension.

---

## 1. Database Architecture & Provisioning

- **Engine**: PostgreSQL 16
- **Extensions**:
  - `vector`: pgvector extension enabled on the database schema.
  - `uuid-ossp` or `pgcrypto`: For UUID generation.
- **Vector Indexes**:
  - `document_chunks_embedding_idx`: HNSW index using cosine distance (`vector_cosine_ops`) for sub-second semantic retrieval across document chunks.
- **Connection Configuration**:
  - Production Pool Size: 50 connections max per instance (`connection_limit=50`).
  - Timeout: 15 seconds (`pool_timeout=15`).
  - SSL Mode: Required (`sslmode=require`).

---

## 2. Controlled Migration Runbook

All database changes are managed through Prisma migrations stored in version control (`prisma/migrations`).

### Standard Deployment Procedure
1. Create a snapshot backup before running any migration:
   ```bash
   ./scripts/backup-db.sh
   ```
2. Verify pending migrations against the production database:
   ```bash
   npm run prisma:migrate:status
   ```
3. Apply pending migrations using non-interactive deployment mode:
   ```bash
   npm run prisma:migrate:deploy
   ```
4. Verify migration state:
   ```bash
   npm run prisma:migrate:status
   ```

> [!WARNING]
> NEVER execute `prisma migrate reset` or `prisma db push` on a production or staging database. Doing so will DROP tables and destroy user data.

---

## 3. Automated Backup Procedure

Automated backups are created using [scripts/backup-db.sh](file:///c:/Users/Rashi/OneDrive/Desktop/controbute/AiStudyMate/study-mate-backend/scripts/backup-db.sh).

### Backup Schedule
- **Full Custom-Format Dumps**: Daily at 02:00 UTC via cron or managed cloud snapshot.
- **WAL / Continuous Archiving**: Enabled via cloud managed database for Point-In-Time-Recovery (PITR).
- **Retention**: Local retention 14 days, remote S3/GCS glacier retention 90 days.

### Manual Backup Command
```bash
# Run ad-hoc backup:
DATABASE_URL="postgresql://user:pass@host:5432/studymatedb" ./scripts/backup-db.sh
```

---

## 4. Disaster Recovery & Restoration Procedure

In the event of database corruption, accidental deletion, or catastrophic cloud region failure, restore using [scripts/restore-db.sh](file:///c:/Users/Rashi/OneDrive/Desktop/controbute/AiStudyMate/study-mate-backend/scripts/restore-db.sh).

### Step-by-Step Restoration
1. Identify the latest valid backup dump and verify its SHA256 checksum:
   ```bash
   sha256sum -c backups/studymate_backup_20261014_100000.dump.sha256
   ```
2. Provision a clean PostgreSQL 16 database with `pgvector` enabled:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
3. Run the restore script:
   ```bash
   DATABASE_URL="postgresql://user:pass@new-host:5432/studymatedb" ./scripts/restore-db.sh backups/studymate_backup_20261014_100000.dump
   ```
4. Verify database schema and record counts:
   ```bash
   npm run prisma:migrate:status
   ```
5. Test application connectivity by calling the deep readiness check:
   ```bash
   curl -i http://localhost:5000/health/ready
   ```
   Expected response:
   ```json
   {
     "status": "ready",
     "checks": {
       "database": "ok",
       "storage": "ok"
     }
   }
   ```
