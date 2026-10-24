# AI StudyMate Backend

AI StudyMate is a production-grade AI learning application backend built with Node.js, Express, TypeScript, PostgreSQL (with pgvector), and Prisma ORM 7.

---

## 1. Prerequisites

- **Node.js**: v20.x or v22.x LTS
- **npm**: v10.x+
- **PostgreSQL**: v15+ (with `pgvector` extension installed for vector embeddings)
- **Redis** (optional in Phase 1; required in future phases for BullMQ background workers)

---

## 2. Local PostgreSQL Setup

### Option A: Using Docker (Recommended)

You can start a PostgreSQL container with the `pgvector` extension pre-installed:

```bash
docker run -d \
  --name studymate-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=studymatedb \
  -p 5432:5432 \
  pgvector/pgvector:pg16
```

### Option B: Using Native PostgreSQL Installation

1. Create the database:
   ```sql
   CREATE DATABASE studymatedb;
   ```
2. Connect to the database and enable the `pgvector` extension:
   ```sql
   \c studymatedb;
   CREATE EXTENSION IF NOT EXISTS vector;
   ```

---

## 3. Environment Configuration

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Verify or update the database URL in `.env`:
   ```env
   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/studymatedb"
   PORT=5000
   NODE_ENV=development
   ```

---

## 4. Prisma 7 Configuration

Prisma 7 uses `prisma.config.ts` for migration datasource resolution and requires driver adapters for runtime queries:

- **Migration Config**: `prisma.config.ts` loads `DATABASE_URL` via `dotenv/config` and specifies the schema path.
- **Client Adapter**: PrismaClient is instantiated with `@prisma/adapter-pg` using a PostgreSQL connection pool (`pg.Pool`).
- **Validation**:
  ```bash
  npm run prisma:validate
  ```
- **Generate Client**:
  ```bash
  npm run prisma:generate
  ```

---

## 5. Available Scripts

- `npm run dev`: Runs server in development mode with nodemon and ts-node.
- `npm run build`: Compiles TypeScript to `dist/`.
- `npm start`: Runs the production bundle from `dist/server.js`.
- `npm test`: Runs the test suite via Vitest.
- `npm run prisma:validate`: Validates Prisma schema and configuration.
- `npm run prisma:generate`: Generates the Prisma client.

---

## 6. Architecture & Folder Structure

```
study-mate-backend/
├── prisma.config.ts         # Prisma 7 configuration file
├── prisma/
│   └── schema.prisma        # Database schema definitions
├── src/
│   ├── config/              # Environment (Zod) and Prisma/DB lifecycle configuration
│   ├── routes/              # Express route definitions (API v1)
│   ├── controllers/         # HTTP request/response controllers
│   ├── services/            # Core business logic
│   ├── repositories/        # Database access layer
│   ├── middleware/          # Request ID, central error handler, request logger, 404
│   ├── validators/          # Input validation schemas
│   ├── utils/               # Structured logger, custom errors
│   ├── modules/             # Feature domain modules (auth, conversations, documents, quizzes, study-plans, usage)
│   ├── ai/                  # AI graphs, nodes, prompts, retrievers, schemas
│   ├── workers/             # Background job processors (BullMQ)
│   ├── tests/               # Unit and integration test suites
│   ├── app.ts               # Shared Express application factory
│   └── server.ts            # Server entry point with graceful shutdown
```

---

## 7. Health & Monitoring

- `GET /health` or `GET /api/v1/health`: Checks system uptime, environment, and PostgreSQL connectivity. Never exposes credentials.
- Error responses follow a uniform envelope:
  ```json
  {
    "error": {
      "code": "ERROR_CODE",
      "message": "Human readable message",
      "details": [],
      "requestId": "uuid"
    }
  }
  ```
