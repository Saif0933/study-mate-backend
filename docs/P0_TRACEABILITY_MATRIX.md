# AI StudyMate — Backend P0 Requirements Traceability Matrix

This matrix provides comprehensive verification and end-to-end traceability for every **P0 requirement** defined in the AI StudyMate Product Requirements Document (PRD), mapping each requirement to its HTTP API route, Express controller, business logic service, Prisma repository, PostgreSQL model, and automated test suites.

---

## 1. Authentication, Sessions & Account Lifecycle

| PRD ID | Requirement Summary | Priority | API Endpoint & Method | Controller & Service | Repository & Prisma Model | Automated Test Suite | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **FR-AUTH-01** | Email registration & Argon2id/bcrypt hashing | **P0** | `POST /api/v1/auth/register` | `AuthController.register`<br>`AuthService.register` | `AuthRepository.createUser`<br>`model User` | `src/tests/auth.test.ts`<br>`src/tests/security-hardening.test.ts` | **VERIFIED** |
| **FR-AUTH-02** | Sign in with credentials & JWT issue | **P0** | `POST /api/v1/auth/login`<br>`POST /api/v1/auth/session` | `AuthController.login`<br>`AuthService.login` | `AuthRepository.findByEmail`<br>`model User`, `model RefreshToken` | `src/tests/auth.test.ts` | **VERIFIED** |
| **FR-AUTH-03** | Protected APIs require valid identity; 401 handling | **P0** | `Authorization: Bearer <token>` | `authenticate` middleware | `AuthRepository.findById`<br>`model User` | `src/tests/middleware.test.ts`<br>`src/tests/auth.test.ts` | **VERIFIED** |
| **FR-AUTH-04** | Refresh token rotation & reuse detection | **P0** | `POST /api/v1/auth/refresh` | `AuthController.refresh`<br>`AuthService.refreshSession` | `AuthRepository.findRefreshToken`<br>`model RefreshToken` | `src/tests/auth.test.ts`<br>`src/tests/reliability-and-lifecycle.test.ts` | **VERIFIED** |
| **FR-AUTH-05** | Single-use password reset workflow | **P0** | `POST /api/v1/auth/forgot-password`<br>`POST /api/v1/auth/reset-password` | `AuthController.forgotPassword`<br>`AuthController.resetPassword` | `AuthRepository.createPasswordResetToken`<br>`model PasswordResetToken` | `src/tests/auth.test.ts` | **VERIFIED** |
| **FR-AUTH-06** | Sign out and revoke active refresh token | **P0** | `POST /api/v1/auth/logout` | `AuthController.logout`<br>`AuthService.logout` | `AuthRepository.revokeRefreshToken`<br>`model RefreshToken` | `src/tests/auth.test.ts` | **VERIFIED** |
| **FR-AUTH-07** | Authenticated user profile retrieval | **P0** | `GET /api/v1/me`<br>`GET /api/v1/auth/me` | `AuthController.getMe`<br>`AuthService.getMe` | `AuthRepository.findById`<br>`model User` | `src/tests/auth.test.ts` | **VERIFIED** |
| **FR-AUTH-08** | Profile update (display name) | **P0** | `PATCH /api/v1/me` | `AuthController.updateProfile`<br>`AuthService.updateProfile` | `AuthRepository.updateProfile`<br>`model User` | `src/tests/usage-and-account.test.ts` | **VERIFIED** |
| **FR-AUTH-09** | Account & data deletion with confirmation | **P0** | `DELETE /api/v1/me` | `AuthController.deleteAccount`<br>`AuthService.deleteAccount` | `AuthRepository.purgeUserData`<br>`FileStorageService.deleteUserStorage` | `src/tests/auth.test.ts`<br>`src/tests/usage-and-account.test.ts` | **VERIFIED** |

---

## 2. AI Tutor & Persistent Conversations

| PRD ID | Requirement Summary | Priority | API Endpoint & Method | Controller & Service | Repository & Prisma Model | Automated Test Suite | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **FR-CHAT-01** | Create, list, retrieve, rename, delete conversations | **P0** | `POST /api/v1/conversations`<br>`GET /api/v1/conversations`<br>`GET /api/v1/conversations/:id`<br>`PATCH /api/v1/conversations/:id`<br>`DELETE /api/v1/conversations/:id` | `ConversationController`<br>`ConversationService` | `ConversationRepository`<br>`model Conversation` | `src/tests/conversations.test.ts`<br>`src/tests/security-hardening.test.ts` | **VERIFIED** |
| **FR-CHAT-02** | Send message & receive persisted AI response | **P0** | `POST /api/v1/conversations/:id/messages` | `ConversationController.sendMessage`<br>`ConversationService.sendMessage` | `ConversationRepository.createMessage`<br>`tutorGraph` (LangGraph)<br>`model Message` | `src/tests/conversations.test.ts`<br>`src/tests/tutor-graph.test.ts` | **VERIFIED** |
| **FR-CHAT-03** | Bounded token context management | **P0** | Context sliding window (10 messages) | `ConversationService.sendMessage`<br>`tutorGraph` | `ConversationRepository.listMessages`<br>`model Message` | `src/tests/conversations.test.ts`<br>`src/tests/tutor-graph.test.ts` | **VERIFIED** |
| **FR-CHAT-04** | AI Telemetry & Usage recording | **P0** | Auto-recorded per AI message | `ConversationService.sendMessage` | `ConversationRepository.recordAIUsage`<br>`model AIUsage` | `src/tests/conversations.test.ts`<br>`src/tests/usage-and-account.test.ts` | **VERIFIED** |

---

## 3. PDF Document Management & Grounded RAG Q&A

| PRD ID | Requirement Summary | Priority | API Endpoint & Method | Controller & Service | Repository & Prisma Model | Automated Test Suite | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **FR-DOC-01** | PDF magic byte verification & size enforcement | **P0** | `POST /api/v1/documents` (multipart) | `DocumentController.uploadDocument`<br>`validatePdfSignature` | `FileStorageService.saveDocumentFile`<br>`model Document` | `src/tests/documents.test.ts`<br>`src/tests/security-hardening.test.ts` | **VERIFIED** |
| **FR-DOC-02** | Private user-isolated storage | **P0** | `uploads/documents/<userId>/<docId>.pdf` | `FileStorageService` | `FileStorageService`<br>`model Document` | `src/tests/documents.test.ts` | **VERIFIED** |
| **FR-DOC-03** | Text extraction & page metadata chunking | **P0** | Background PDF parsing | `DocumentService.processDocumentUpload`<br>`parsePdfDocument` | `RecursiveTextSplitter`<br>`model DocumentChunk` | `src/tests/documents.test.ts` | **VERIFIED** |
| **FR-DOC-04** | pgvector HNSW semantic embeddings | **P0** | Vector indexing (1536 dims) | `DocumentRetriever.indexDocumentChunks` | `prisma.$executeRaw` (HNSW cosine)<br>`model DocumentChunk` | `src/tests/documents.test.ts`<br>`src/tests/document-qa-graph.test.ts` | **VERIFIED** |
| **FR-DOC-05** | Grounded Q&A with citations | **P0** | `POST /api/v1/documents/:id/questions` | `DocumentController.askQuestion`<br>`DocumentService.askDocumentQuestion` | `documentQAGraph` (LangGraph)<br>`DocumentRetriever` | `src/tests/documents.test.ts`<br>`src/tests/document-qa-graph.test.ts` | **VERIFIED** |
| **FR-DOC-06** | Insufficient evidence detection | **P0** | Returns `insufficientEvidence: true` | `documentQAGraph`<br>`evaluateGroundedness` | `documentQAGraph` node | `src/tests/documents.test.ts`<br>`src/tests/document-qa-graph.test.ts` | **VERIFIED** |
| **FR-DOC-07** | Cascading deletion of doc, chunks, & disk files | **P0** | `DELETE /api/v1/documents/:id` | `DocumentController.deleteDocument`<br>`DocumentService.deleteDocument` | `DocumentRepository.deleteDocument`<br>`FileStorageService.deleteDocumentFile` | `src/tests/documents.test.ts` | **VERIFIED** |

---

## 4. Practice Quizzes & Automated Scoring

| PRD ID | Requirement Summary | Priority | API Endpoint & Method | Controller & Service | Repository & Prisma Model | Automated Test Suite | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **FR-QUIZ-01** | Generate quiz from topic or document | **P0** | `POST /api/v1/quizzes` | `QuizController.createQuiz`<br>`QuizService.createQuiz` | `quizGeneratorGraph` (LangGraph)<br>`QuizRepository`<br>`model Quiz`, `model QuizQuestion` | `src/tests/quizzes.test.ts`<br>`src/tests/quiz-generator-graph.test.ts` | **VERIFIED** |
| **FR-QUIZ-02** | Difficulty and question count bounds | **P0** | `1-20 questions`, `EASY/MEDIUM/HARD` | `createQuizSchema` validation | `model Quiz` | `src/tests/quizzes.test.ts` | **VERIFIED** |
| **FR-QUIZ-03** | Start attempt & hide answer keys | **P0** | `POST /api/v1/quizzes/:id/attempts` | `QuizController.startAttempt`<br>`QuizService.startAttempt` | `QuizRepository.createAttempt`<br>`model QuizAttempt` | `src/tests/quizzes.test.ts` | **VERIFIED** |
| **FR-QUIZ-04** | Server-side scoring & response persistence | **P0** | `POST /api/v1/quiz-attempts/:id/submit` | `QuizController.submitAttempt`<br>`QuizService.submitAttempt` | `QuizRepository.saveAttemptResponses`<br>`model QuizAttempt`, `model QuizResponse` | `src/tests/quizzes.test.ts` | **VERIFIED** |
| **FR-QUIZ-05** | Attempt review with explanations | **P0** | `GET /api/v1/quiz-attempts/:id/review` | `QuizController.reviewAttempt`<br>`QuizService.reviewAttempt` | `QuizRepository.findAttemptById`<br>`model QuizQuestion`, `model QuizResponse` | `src/tests/quizzes.test.ts` | **VERIFIED** |

---

## 5. Personalized Study Planner

| PRD ID | Requirement Summary | Priority | API Endpoint & Method | Controller & Service | Repository & Prisma Model | Automated Test Suite | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **FR-PLAN-01** | Plan setup: exam date, subjects, daily minutes, timezone | **P0** | `POST /api/v1/study-plans` | `StudyPlanController.createStudyPlan`<br>`StudyPlanService.createStudyPlan` | `studyPlanGraph` (LangGraph)<br>`StudyPlanRepository`<br>`model StudyPlan`, `model StudyTask` | `src/tests/study-plans.test.ts`<br>`src/tests/study-plan-graph.test.ts` | **VERIFIED** |
| **FR-PLAN-02** | Structured agenda tasks with dates and duration limits | **P0** | Task ordering & duration clamping | `StudyPlanService.createStudyPlan` | `StudyPlanRepository.createPlanWithTasks`<br>`model StudyTask` | `src/tests/study-plans.test.ts` | **VERIFIED** |
| **FR-PLAN-03** | Task completion toggle and persistence | **P0** | `PATCH /api/v1/study-tasks/:id` | `StudyPlanController.updateStudyTask`<br>`StudyPlanService.updateStudyTask` | `StudyPlanRepository.updateTask`<br>`model StudyTask` | `src/tests/study-plans.test.ts` | **VERIFIED** |
| **FR-PLAN-04** | Custom task addition & deletion | **P0** | `POST /api/v1/study-plans/:id/tasks`<br>`DELETE /api/v1/study-tasks/:id` | `StudyPlanController.createTask`<br>`StudyPlanController.deleteTask` | `StudyPlanRepository.createTask`<br>`StudyPlanRepository.deleteTask` | `src/tests/study-plans.test.ts` | **VERIFIED** |
| **FR-PLAN-05** | Plan regeneration preserving completed tasks | **P0** | `POST /api/v1/study-plans/:id/regenerate` | `StudyPlanController.regenerateStudyPlan`<br>`StudyPlanService.regenerateStudyPlan` | `StudyPlanRepository.replaceTasks`<br>`model StudyTask` | `src/tests/study-plans.test.ts` | **VERIFIED** |

---

## 6. Usage Accounting, Quotas & Feedback

| PRD ID | Requirement Summary | Priority | API Endpoint & Method | Controller & Service | Repository & Prisma Model | Automated Test Suite | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **FR-SYS-01** | AI Usage monitoring & quota accounting | **P0** | `GET /api/v1/usage`<br>`GET /api/v1/me/usage` | `UsageController.getUsage`<br>`UsageService.getUsage` | `UsageRepository.getUserUsageRecords`<br>`model AIUsage` | `src/tests/usage-and-account.test.ts` | **VERIFIED** |
| **FR-SYS-02** | Quota exhaustion explanation without invented values | **P0** | `isExhausted`, `quotaMessage`, `resetTime` | `UsageService.getUsage`<br>`calculateEstimatedCost` | `UsageRepository.getTodayRequestCount`<br>`model AIUsage` | `src/tests/usage-and-account.test.ts` | **VERIFIED** |
| **FR-SYS-03** | Server-side quota enforcement with concurrency locking | **P0** | Pre-flight quota check before LLM calls | `UsageService.checkQuota` | `UsageRepository.checkAndLockUserQuota` (`SELECT ... FOR UPDATE`) | `src/tests/usage-and-account.test.ts` | **VERIFIED** |
| **FR-SYS-04** | AI response feedback with message authorization | **P0** | `POST /api/v1/feedback`<br>`POST /api/v1/usage/feedback` | `UsageController.submitFeedback`<br>`UsageService.submitFeedback` | `UsageRepository.createFeedback`<br>`model Feedback` | `src/tests/usage-and-account.test.ts` | **VERIFIED** |
