# AI StudyMate — Operational Monitoring, Metrics & SLAs

This document defines the production Service Level Objectives (SLOs), Service Level Agreements (SLAs), health check endpoints, and monitoring metrics for the **AI StudyMate** backend.

---

## 1. Service Level Objectives (SLOs) & SLAs

| Metric | Target SLO | Measurement Window | Alert Threshold |
| :--- | :--- | :--- | :--- |
| **API Availability** | **99.9%** uptime | 30-day rolling | Availability < 99.5% |
| **API Error Rate** | **< 0.5%** 5xx errors | 5-minute rolling | Error rate > 1.0% |
| **Chat Latency (P95)** | **< 1,500 ms** | 10-minute rolling | P95 latency > 2,500 ms |
| **Quiz Generation (P95)**| **< 3,000 ms** | 10-minute rolling | P95 latency > 5,000 ms |
| **Document Processing**| **< 10 seconds** (10MB PDF) | Per document | Processing time > 20s |
| **Database Query Latency**| **< 50 ms** (P95) | 5-minute rolling | DB latency > 100 ms |

---

## 2. Health & Monitoring Probes

The backend exposes three dedicated monitoring endpoints:

### A. Liveness Probe: `GET /health`
- **Purpose**: Fast container health verification for load balancers (AWS ALB, Cloudflare, NGINX).
- **HTTP Code**: `200` (healthy), `503` (database down).
- **Sample Payload**:
  ```json
  {
    "status": "ok",
    "timestamp": "2026-10-14T10:00:00.000Z",
    "uptimeSeconds": 14205,
    "environment": "production",
    "services": {
      "database": {
        "status": "connected",
        "latencyMs": 8
      }
    }
  }
  ```

### B. Readiness Probe: `GET /health/ready`
- **Purpose**: Strict check for container orchestrators (K8s, ECS, Fly.io, Render) before routing traffic to an instance. Verifies DB read/write and file upload volume writability.
- **HTTP Code**: `200` (ready), `503` (not ready).
- **Sample Payload**:
  ```json
  {
    "status": "ready",
    "timestamp": "2026-10-14T10:00:00.000Z",
    "checks": {
      "database": "ok",
      "storage": "ok"
     }
  }
  ```

### C. Operational Telemetry & Metrics: `GET /health/metrics`
- **Purpose**: Exposes process memory, database latency, and real-time AI usage/cost counters.
- **Authentication**: Requires `Authorization: Bearer <METRICS_AUTH_TOKEN>` when `METRICS_AUTH_TOKEN` is configured.
- **Sample Payload**:
  ```json
  {
    "timestamp": "2026-10-14T10:00:00.000Z",
    "environment": "production",
    "uptimeSeconds": 14205,
    "process": {
      "nodeVersion": "v22.10.0",
      "pid": 1,
      "memory": {
        "rssMb": 84.52,
        "heapTotalMb": 52.18,
        "heapUsedMb": 38.41
      }
    },
    "database": {
      "status": "connected",
      "latencyMs": 7
    },
    "aiTelemetry": {
      "totalRequests": 1250,
      "successfulRequests": 1242,
      "failedRequests": 6,
      "rateLimitedRequests": 2,
      "totalCostUsd": 4.825,
      "costAlertThresholdUsd": 250.0,
      "costExceeded": false,
      "dailyQuotaLimit": 50,
      "monthlyQuotaLimit": 500,
      "modelId": "gpt-4o",
      "embeddingModelId": "text-embedding-3-small"
    }
  }
  ```

---

## 3. Cost & Safety Guardrails

1. **Daily & Monthly User Quotas**:
   - Free/Standard users are limited to 50 requests/day and 500 requests/month.
   - Enforced in `UsageService.checkQuota`.
2. **Adversarial Prompt Guard**:
   - Messages > 8,000 characters are rejected with a 400 error.
3. **Global AI Cost Circuit Breaker**:
   - `AI_GLOBAL_MONTHLY_COST_LIMIT_USD` sets a ceiling (e.g. $250.00).
   - If total monthly OpenAI expenditure exceeds the budget, `GET /health/metrics` flags `costExceeded: true` and triggers a high-priority alert.
