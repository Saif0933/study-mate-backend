# AI StudyMate - Backup Retention & Data Deletion Architecture

## 1. Executive Overview

This document specifies the data retention lifecycle, account deletion guarantees (in compliance with GDPR Article 17 "Right to Erasure" and CCPA/CPRA), and disaster recovery backup management policies for the AI StudyMate production platform.

---

## 2. Real-Time Account Deletion Workflow

When an authenticated user requests account deletion via `DELETE /api/v1/me`:

1. **Immediate Revocation (T = 0s)**:
   - The user account status in PostgreSQL is updated to `DELETION_PENDING`.
   - All refresh tokens belonging to the user are invalidated (`revokedAt = NOW()`).
   - All subsequent requests bearing previous JWT tokens are rejected immediately at the API gateway / middleware boundary with HTTP `403 Forbidden` or `401 Unauthorized`.

2. **Storage Purge (T < 1s)**:
   - The user's private object/disk storage directory (`uploads/documents/<userId>/`) is recursively deleted (`fs.rm` / object storage bucket prefix deletion).
   - All original user PDF uploads are completely removed from physical storage.

3. **Relational & Vector Purge (T < 2s)**:
   - The user record in PostgreSQL is hard-deleted within an atomic transaction.
   - Cascading foreign-key constraints immediately delete all associated user data:
     - `Conversation` and `Message` entities
     - `Document` and `DocumentChunk` entities (including 1536-dimensional pgvector semantic embeddings)
     - `Quiz`, `QuizQuestion`, `QuizAttempt`, and `QuizResponse` records
     - `StudyPlan` and `StudyTask` schedules
     - `AIUsage` telemetry and accounting rows
     - `Feedback` submissions
     - `PasswordResetToken` and `RefreshToken` tokens

4. **Idempotency & Failure Tolerance**:
   - The deletion pipeline is designed to be safe under retries. If a transient error occurs during partial deletion, subsequent calls to `DELETE /api/v1/me` tolerate missing files or already-deleted rows (handling Prisma `P2025` and file `ENOENT` safely).

---

## 3. Backup Retention & Right-to-Erasure Protocol

### 3.1 Backup Strategy
- **Automated Snapshots**: Daily point-in-time PostgreSQL database snapshots (`pg_dump` and cloud volume snapshots).
- **Snapshot Retention Window**: Backups are retained on a strict 30-day rolling lifecycle. Snapshots older than 30 days are automatically pruned by backup retention lifecycle rules.

### 3.2 Handling Deleted Accounts in Historical Backups
Database backups are immutable, append-only archives created for disaster recovery and business continuity. Modifying individual records inside compressed, encrypted binary backup archives is mathematically and operationally prohibited.

To guarantee that deleted accounts and user data are never inadvertently restored:

1. **Tombstone Log Registry**:
   - Deletion events are tracked in a secure operational audit log with the anonymous user UUID and timestamp (without recording personal data, passwords, prompts, or documents).
   
2. **Post-Restore Purge Hook**:
   - In the event of a disaster recovery restore from a historical backup snapshot:
     - A mandatory post-restore sanitization script executes before the database accepts public traffic.
     - The script compares the restored database against the external Tombstone Log Registry.
     - Any user account or user-owned rows that were scheduled for deletion or deleted after the backup snapshot timestamp are immediately purged from the restored database.

3. **30-Day Backup Expiry**:
   - By day 30, all backup snapshots that contained the deleted user's data have naturally expired and been permanently destroyed from backup storage.

---

## 4. Privacy & Operational Security Guarantees

- **No Secret/Prompt Leakage**: The backend logger explicitly censors user passwords, refresh token secrets, raw prompt texts, and document contents. Only non-sensitive metrics (`userId`, `documentId`, `latencyMs`, `status`, token counts) are emitted to operational logs.
- **Derived Data Erasure**: Account deletion guarantees that derived AI data (embeddings, chunk summaries, study tasks, quiz questions) are completely purged alongside the source files.
