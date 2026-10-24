# AI StudyMate — Production Backend Deployment Guide

This document provides complete instructions for deploying the **AI StudyMate** production backend across modern cloud environments (Docker, Render, Fly.io, AWS ECS/App Runner, GCP Cloud Run), managing environment secrets, executing controlled migrations, and handling rollbacks and operational incidents.

---

## 1. Hosting Architecture Overview

The backend is built as a stateless containerized Node.js (TypeScript) service communicating with:
- **Managed PostgreSQL 16** with the `pgvector` extension enabled for semantic retrieval.
- **Persistent/Object Storage** (Cloudinary or local encrypted volume) for student PDF uploads.
- **Optional Redis Cache & BullMQ** for asynchronous queue processing.
- **OpenAI API** for GPT-4o generation and text-embedding-3-small embeddings.

```
                    [ Flutter Android Client ]
                               │ (HTTPS TLS 1.3)
                               ▼
                    [ Reverse Proxy / CDN ]
                   (Cloudflare / NGINX / ALB)
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
   [ Backend Container A ]               [ Backend Container B ]
            │                                     │
   ┌────────┴────────┬──────────────┬─────────────┴────────┐
   ▼                 ▼              ▼                      ▼
[ PostgreSQL 16 ] [ Redis 7 ]  [ Object Storage ]   [ OpenAI API ]
   (pgvector)      (BullMQ)    (Cloudinary/S3)        (GPT-4o)
```

---

## 2. Environment Matrix & Secret Management

| Environment | Purpose | Database | Host / URL | Secret Facility |
| :--- | :--- | :--- | :--- | :--- |
| **Development** | Local engineering | Local Docker Postgres 16 | `http://localhost:5000` | Local `.env` |
| **Staging** | Pre-release QA, mobile E2E | Staging Managed Postgres | `https://staging-api.studymate.ai` | CI/CD Secrets / PaaS |
| **Production** | Live mobile app traffic | High-Availability Postgres | `https://api.studymate.ai` | AWS Secrets / Vault / Render |

### Master Environment Variables

| Variable | Required | Staging Example | Production Example | Description |
| :--- | :--- | :--- | :--- | :--- |
| `NODE_ENV` | Yes | `staging` | `production` | Enables production error redaction |
| `PORT` | Yes | `5000` | `8080` (or dynamic) | HTTP port |
| `DATABASE_URL` | Yes | `postgresql://...` | `postgresql://...sslmode=require` | PostgreSQL connection string |
| `JWT_SECRET` | Yes | 32+ char secret | 64+ char random hex | Secret for JWT HMAC signatures |
| `CORS_ORIGIN` | Yes | `https://staging-app...` | `https://app.studymate.ai` | Allowed origins (Mobile uses Bearer) |
| `TRUST_PROXY` | Yes | `true` | `true` | Set to true behind reverse proxy |
| `LOG_LEVEL` | Yes | `debug` | `info` | Pino log level |
| `OPENAI_API_KEY` | Yes | `sk-proj-staging-...` | `sk-proj-prod-...` | Dedicated production OpenAI key |
| `OPENAI_MODEL` | No | `gpt-4o` | `gpt-4o` | Primary generation model |
| `OPENAI_EMBEDDING_MODEL` | No | `text-embedding-3-small` | `text-embedding-3-small` | Vector embedding model |
| `AI_GLOBAL_MONTHLY_COST_LIMIT_USD` | No | `50.0` | `250.0` | Global monthly AI cost circuit breaker |
| `METRICS_AUTH_TOKEN` | Yes | `staging-token` | `prod-token` | Bearer token for `GET /health/metrics` |

> [!CAUTION]
> Never commit `.env` or production secrets to Git. Inject secrets into runtime containers via the platform's native secret manager.

---

## 3. Platform Deployment Blueprints

### A. Docker / Docker Compose Deployment
```bash
# 1. Build the production multi-stage image
docker build -t studymate-backend:latest .

# 2. Deploy using production compose profile
docker compose -f docker-compose.prod.yml up -d
```

### B. Render Deployment
1. Connect GitHub repository to Render.
2. Select **Blueprint** and specify [render.yaml](file:///c:/Users/Rashi/OneDrive/Desktop/controbute/AiStudyMate/study-mate-backend/render.yaml).
3. In the Render Dashboard, fill in `OPENAI_API_KEY` under Environment Secrets.
4. Render automatically provisions PostgreSQL 16, compiles the TypeScript build, executes `prisma migrate deploy`, and binds the health check to `/health`.

### C. Fly.io Deployment
```bash
# 1. Create Fly app and set production secrets
flyctl apps create studymate-backend
flyctl secrets set DATABASE_URL="postgresql://..." JWT_SECRET="..." OPENAI_API_KEY="..."

# 2. Deploy using fly.toml
flyctl deploy --config fly.toml
```

---

## 4. Controlled Database Migration Procedure

In production, database migrations must **NEVER** use `prisma migrate dev` or `prisma db push`, which can reset the database or cause destructive schema loss.

### Production Migration Command
```bash
# Executes prisma migrate deploy to apply pending migrations safely:
npm run prisma:migrate:deploy

# Or run the production wrapper:
npm run migrate:prod
```

### Zero-Downtime Migration Rules
1. **Expand and Contract Pattern**:
   - Add new columns as optional (`?`) or with defaults.
   - Deploy backend code that writes to both old and new columns.
   - Backfill existing data.
   - Deploy code reading only from the new column.
   - Remove the old column in a subsequent release.
2. **Never Drop Columns In-Place** while old application instances are still taking traffic.
3. **Always Run Pre-Deployment Backup**:
   ```bash
   ./scripts/backup-db.sh
   ```

---

## 5. Rollback & Rollforward Strategy

If a newly deployed backend version introduces an error or elevated latency:

1. **Traffic Rollback**:
   - In Render/Fly/AWS, trigger an instant rollback to the previous container image SHA.
   - The previous container will immediately accept traffic because schema changes followed the Expand-and-Contract rule.
2. **Database Rollback (If needed)**:
   - Check migration status: `npm run prisma:migrate:status`.
   - If a rollback script is required, apply a downward SQL migration or restore from the pre-deployment snapshot:
     ```bash
     ./scripts/restore-db.sh ./backups/studymate_backup_<PRE_DEPLOYMENT_TIMESTAMP>.dump
     ```

---

## 6. Incident Response Runbook

| Severity | Definition | Action Required | Response SLA |
| :--- | :--- | :--- | :--- |
| **P0 (Critical)** | Entire backend down, database unreachable, or data breach | Page on-call, check `/health`, restart containers, check DB connections, engage incident lead | 15 mins |
| **P1 (High)** | OpenAI API outage, rate limit spike, or PDF upload failures | Enable degraded mode, verify OpenAI status, check monthly cost threshold | 30 mins |
| **P2 (Medium)** | Non-critical background task delay, high latency on study plans | Inspect query latency via `/health/metrics`, tune connection pool | 2 hours |

### Emergency Kill-Switch for AI Cost Exhaustion
If OpenAI usage exceeds safety limits:
1. `GET /health/metrics` will report `"costExceeded": true`.
2. Set `AI_DAILY_QUOTA_LIMIT=0` or revoke the compromised key to halt unbounded AI requests immediately.
