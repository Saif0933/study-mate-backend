# AI StudyMate — Frontend & Backend API Integration Checklist
**Phase 1: API Integration Foundation & Contract Traceability Matrix**
**Target Platforms**: Flutter (Android, iOS, Web, Desktop) & Node.js/Express Backend

---

## 1. Architectural Foundation & Network Configuration

### 1.1 Platform-Aware Base URL Resolution
AI StudyMate uses a centralized, multi-platform URL resolution strategy in `AppConfig` (`study_mate_frontend/lib/core/config/app_config.dart`):

| Environment / Target | Default Host / URL | Configuration Mechanism |
| :--- | :--- | :--- |
| **Android Emulator** | `http://10.0.2.2:5000/api/v1` | Automatic via `defaultTargetPlatform == TargetPlatform.android` |
| **Physical Device (LAN)** | `http://<LAN_IP>:5000/api/v1` | `--dart-define=BACKEND_HOST=192.168.x.x` or `AppConfig.setBaseUrlOverride(...)` |
| **iOS Simulator / Desktop** | `http://127.0.0.1:5000/api/v1` | Default loopback |
| **Web Browser** | `http://localhost:5000/api/v1` | Automatic via `kIsWeb` |
| **Staging / Production** | `https://api.studymate.ai/api/v1` | `--dart-define=API_BASE_URL=https://...` |

### 1.2 Central Dio & HTTP Client Pipeline
- **Singleton Management**: Riverpod `apiClientProvider` and `dioProvider` prevent duplicate Dio instances.
- **Interceptors**: Single `AuthInterceptor` attaches `Authorization: Bearer <token>` on all requests, avoiding duplicate headers.
- **Timeouts**:
  - `connectTimeout`: 15 seconds
  - `receiveTimeout`: 45 seconds (allows streaming & AI LLM graph synthesis)
  - `sendTimeout`: 30 seconds (allows multipart PDF note uploads)
- **JSON Envelope Standards**:
  - Success responses: unwraps `{ "data": ... }` automatically, or returns the raw object.
  - Error responses: unwraps standard PRD envelope:
    ```json
    {
      "error": {
        "code": "BAD_REQUEST",
        "message": "Human readable description",
        "details": [],
        "requestId": "uuid"
      }
    }
    ```
- **Consistent Error Conversion**:
  - `CONNECTION_REFUSED`: Backend process offline or unreachable; provides user-facing host guidance (`isRetryable: true`).
  - `TIMEOUT_ERROR`: Request exceeded connect/send/receive deadline (`isRetryable: true`).
  - `INVALID_JSON`: Malformed JSON or non-JSON HTML error (`isRetryable: false`).
  - `AUTH_REQUIRED` / `UNAUTHORIZED`: 401 response; triggers secure credential clearing (`isRetryable: false`).
  - `RATE_LIMIT_EXCEEDED`: 429 response; triggers retry backoff (`isRetryable: true`).

### 1.3 Security & Secret Isolation
- **Client Zero-Trust**: OpenAI API keys, database credentials, JWT secrets, and admin tokens are kept strictly in backend environment variables.
- **Production CORS**: `envSchema` strictly rejects wildcard `CORS_ORIGIN=*` in `production` mode, enforcing trusted origins only.

---

## 2. Screen-by-Screen API Integration Matrix

The following matrix documents every user-facing Flutter screen, its required backend endpoints, HTTP methods, headers, schemas, and corresponding Riverpod controllers.

### 2.1 System Foundation & Health Probes

| Screen / Component | Feature | Backend Endpoint | Method | Request Format | Response Payload Format | Flutter Repository / Provider |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **App Startup / Splash** | Liveness & DB connectivity check | `/api/v1/health` | `GET` | Headers: `Accept: application/json` | `{ status: "ok"|"degraded", timestamp: string, uptimeSeconds: number, services: { database: { status: "connected" } } }` | `HealthRepository`<br>`backendHealthProvider` |
| **Settings & Diagnostics** | Telemetry, memory & AI quota status | `/api/v1/health/metrics` | `GET` | Headers: `Authorization: Bearer <METRICS_TOKEN>` (if enabled) | `{ uptimeSeconds: number, process: {...}, database: {...}, aiTelemetry: { totalRequests, totalCostUsd, dailyQuotaLimit } }` | `HealthRepository.getOperationalMetrics()` |

---

### 2.2 Authentication & User Lifecycle

| Screen | Route | Backend Endpoint | Method | Request Body / Query | Success Response Data | Errors Handled | Flutter Controller / Provider |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **LoginScreen** | `/login` | `POST /api/v1/auth/login`<br>*(alias: `/auth/session`)* | `POST` | `{ "email": string, "password": string }` | `{ "token": string, "user": { "id": string, "email": string, "fullName": string } }` | `INVALID_CREDENTIALS` (401), `VALIDATION_ERROR` (400), `ACCOUNT_DISABLED` (403) | `AuthRepository`<br>`AuthController`<br>`authControllerProvider` |
| **RegisterScreen** | `/register` | `POST /api/v1/auth/register` | `POST` | `{ "email": string, "password": string, "fullName": string }` | `{ "token": string, "user": { "id": string, "email": string, "fullName": string } }` | `EMAIL_ALREADY_EXISTS` (409), `WEAK_PASSWORD` (400), `VALIDATION_ERROR` (400) | `AuthRepository`<br>`AuthController` |
| **ForgotPasswordScreen** | `/forgot-password` | `POST /api/v1/auth/forgot-password` | `POST` | `{ "email": string }` | `{ "message": "Password reset link sent", "resetToken": string }` *(dev/test)* | `RATE_LIMIT_EXCEEDED` (429), `VALIDATION_ERROR` (400) | `AuthRepository`<br>`AuthController` |
| **ResetPasswordScreen** | `/reset-password` | `POST /api/v1/auth/reset-password` | `POST` | `{ "token": string, "newPassword": string }` | `{ "message": "Password reset successfully" }` | `INVALID_OR_EXPIRED_TOKEN` (400), `WEAK_PASSWORD` (400) | `AuthRepository`<br>`AuthController` |
| **Settings (Sign Out)** | `/settings` | Client session purge | Local | Local Secure Storage purge | `SecureStorageService.clearSession()` | None (local idempotency) | `AuthController.logout()` |

---

### 2.3 AI Study Tutor & Conversations

| Screen | Route | Backend Endpoint | Method | Request Body / Query | Success Response Data | Errors Handled | Flutter Controller / Provider |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **ConversationsScreen** | `/chat` (Tab 1) | `GET /api/v1/conversations` | `GET` | Headers: `Authorization: Bearer <token>` | `[{ "id": string, "title": string, "subject": string, "createdAt": string, "updatedAt": string }]` | `UNAUTHORIZED` (401), `CONNECTION_REFUSED` | `TutorRepository`<br>`conversationsProvider` |
| **ConversationsScreen** | `/chat` (New Session) | `POST /api/v1/conversations` | `POST` | `{ "title": string, "subject"?: string }` | `{ "id": string, "title": string, "subject": string, "messages": [] }` | `VALIDATION_ERROR` (400), `DAILY_QUOTA_EXCEEDED` (429) | `TutorRepository`<br>`conversationsProvider.notifier` |
| **ChatScreen** | `/chat/:id` | `GET /api/v1/conversations/:id` | `GET` | None | `{ "id": string, "title": string, "messages": [{ "id": string, "role": "USER"|"ASSISTANT", "content": string, "createdAt": string }] }` | `NOT_FOUND` (404), `UNAUTHORIZED` (401) | `TutorRepository`<br>`activeConversationProvider` |
| **ChatScreen** | `/chat/:id` (Send Message) | `POST /api/v1/conversations/:id/messages` | `POST` | `{ "content": string, "model"?: string }` | `{ "id": string, "role": "ASSISTANT", "content": string, "tokensUsed": number, "createdAt": string }` | `AI_SERVICE_UNAVAILABLE` (503), `DAILY_QUOTA_EXCEEDED` (429) | `TutorRepository`<br>`activeConversationProvider.notifier` |
| **ConversationsScreen** | Delete Session | `DELETE /api/v1/conversations/:id` | `DELETE` | None | `{ "message": "Conversation deleted" }` | `NOT_FOUND` (404) | `TutorRepository`<br>`conversationsProvider.notifier` |

---

### 2.4 Document Library & PDF Context Q&A

| Screen | Route | Backend Endpoint | Method | Request Body / Query | Success Response Data | Errors Handled | Flutter Controller / Provider |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **NotesListScreen** | `/documents` (Tab 2) | `GET /api/v1/documents` | `GET` | Headers: `Authorization: Bearer <token>` | `[{ "id": string, "title": string, "fileName": string, "fileSize": number, "status": "PENDING"|"PROCESSING"|"READY"|"FAILED", "pageCount": number, "createdAt": string }]` | `UNAUTHORIZED` (401) | `DocumentRepository`<br>`documentsListProvider` |
| **NoteUploadScreen** | `/documents/upload` | `POST /api/v1/documents` | `POST` | `multipart/form-data`: `file: File (PDF, <= 25MB)` | `{ "id": string, "title": string, "status": "PROCESSING", "pageCount": number }` | `FILE_TOO_LARGE` (413), `UNSUPPORTED_MEDIA_TYPE` (415), `QUOTA_EXCEEDED` (429) | `DocumentRepository`<br>`documentUploadControllerProvider` |
| **DocumentChatScreen** | `/pdf-chat` | `POST /api/v1/documents/:id/qa` | `POST` | `{ "query": string }` | `{ "answer": string, "citations": [{ "page": number, "snippet": string, "relevanceScore": number }] }` | `DOCUMENT_NOT_READY` (400), `NOT_FOUND` (404) | `DocumentRepository`<br>`documentQaProvider` |
| **NotesListScreen** | Delete Note | `DELETE /api/v1/documents/:id` | `DELETE` | None | `{ "message": "Document removed" }` | `NOT_FOUND` (404) | `DocumentRepository`<br>`documentsListProvider.notifier` |

---

### 2.5 Quiz Generation & Practice

| Screen | Route | Backend Endpoint | Method | Request Body / Query | Success Response Data | Errors Handled | Flutter Controller / Provider |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **QuizListScreen** | `/quiz` (Tab 3) | `GET /api/v1/quizzes` | `GET` | Headers: `Authorization: Bearer <token>` | `[{ "id": string, "title": string, "difficulty": "EASY"|"MEDIUM"|"HARD", "questionCount": number, "bestScore": number?, "createdAt": string }]` | `UNAUTHORIZED` (401) | `QuizRepository`<br>`quizListProvider` |
| **QuizCreateScreen** | `/quiz/create` | `POST /api/v1/quizzes` | `POST` | `{ "title": string, "topic": string, "difficulty": string, "questionCount": number, "documentId"?: string }` | `{ "id": string, "title": string, "questions": [{ "id": string, "questionText": string, "options": string[], "explanation": string }] }` | `AI_GENERATION_FAILED` (500), `INVALID_TOPIC` (400), `QUOTA_EXCEEDED` (429) | `QuizRepository`<br>`quizCreateControllerProvider` |
| **QuizPlayScreen** | `/quiz/:id/play` | `GET /api/v1/quizzes/:id` | `GET` | None | `{ "id": string, "title": string, "questions": [{ "id": string, "questionText": string, "options": string[] }] }` | `NOT_FOUND` (404) | `QuizRepository`<br>`activeQuizProvider` |
| **QuizResultScreen** | `/quiz/:id/submit` | `POST /api/v1/quizzes/:id/submit` | `POST` | `{ "answers": [{ "questionId": string, "selectedOptionIndex": number }] }` | `{ "attemptId": string, "score": number, "totalQuestions": number, "percentage": number, "passed": boolean, "review": [...] }` | `VALIDATION_ERROR` (400), `ALREADY_SUBMITTED` (400) | `QuizRepository`<br>`quizAttemptControllerProvider` |

---

### 2.6 Adaptive Study Planner & Tasks

| Screen | Route | Backend Endpoint | Method | Request Body / Query | Success Response Data | Errors Handled | Flutter Controller / Provider |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **StudyPlanDashboardScreen** | `/study-planner` (Tab 4) | `GET /api/v1/study-plans/active` | `GET` | Headers: `Authorization: Bearer <token>` | `{ "id": string, "title": string, "status": "ACTIVE", "dailyMinutes": number, "tasks": [{ "id": string, "title": string, "subject": string, "dueDate": string, "status": "PENDING"|"COMPLETED"|"SKIPPED" }] }` | `NOT_FOUND` (404) *(handled cleanly as empty state)* | `StudyPlanRepository`<br>`activeStudyPlanProvider` |
| **StudyPlanCreateScreen** | `/study-planner/create` | `POST /api/v1/study-plans` | `POST` | `{ "title": string, "subjects": string[], "dailyMinutes": number, "targetExamDate": string, "timezone": string }` | `{ "id": string, "title": string, "tasks": [...] }` | `ACTIVE_PLAN_EXISTS` (400), `VALIDATION_ERROR` (400) | `StudyPlanRepository`<br>`studyPlanCreateControllerProvider` |
| **StudyPlanDetailScreen** | Update Task Status | `PATCH /api/v1/study-tasks/:id/status` | `PATCH` | `{ "status": "COMPLETED"|"SKIPPED"|"PENDING", "completedAt"?: string }` | `{ "id": string, "status": string, "completedAt": string }` | `TASK_NOT_FOUND` (404) | `StudyPlanRepository`<br>`studyPlanTaskControllerProvider` |
| **StudyPlanDetailScreen** | Edit Task Details | `PATCH /api/v1/study-tasks/:id` | `PATCH` | `{ "title"?: string, "dueDate"?: string, "notes"?: string }` | `{ "id": string, "title": string, "dueDate": string }` | `TASK_NOT_FOUND` (404) | `StudyPlanRepository`<br>`studyPlanTaskControllerProvider` |
| **StudyPlanDashboardScreen** | Regenerate Plan | `POST /api/v1/study-plans/:id/regenerate` | `POST` | `{ "reason": string }` | `{ "id": string, "tasks": [...] }` | `PLAN_NOT_FOUND` (404) | `StudyPlanRepository`<br>`activeStudyPlanProvider.notifier` |

---

### 2.7 Settings, Quota Usage & Privacy

| Screen | Route | Backend Endpoint | Method | Request Body / Query | Success Response Data | Errors Handled | Flutter Controller / Provider |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **SettingsScreen (Usage)** | `/settings` | `GET /api/v1/usage/summary` | `GET` | Headers: `Authorization: Bearer <token>` | `{ "dailyRequestsUsed": number, "dailyLimit": number, "monthlyRequestsUsed": number, "monthlyLimit": number, "quotaRemaining": number, "resetTime": string }` | `UNAUTHORIZED` (401) | `UsageRepository`<br>`userUsageProvider` |
| **SettingsScreen (Feedback)**| Feedback Dialog | `POST /api/v1/feedback` | `POST` | `{ "type": "BUG"|"FEATURE"|"GENERAL", "message": string, "rating"?: number }` | `{ "id": string, "message": "Feedback submitted successfully" }` | `VALIDATION_ERROR` (400) | `FeedbackRepository`<br>`feedbackControllerProvider` |
| **SettingsScreen (Delete)** | Delete Account Dialog | `DELETE /api/v1/me` | `DELETE` | `{ "password": string }` | `{ "message": "Account successfully deleted and all associated data purged" }` | `INVALID_PASSWORD` (401), `UNAUTHORIZED` (401) | `AuthRepository`<br>`AuthController.deleteAccount()` |
| **PrivacyPolicyScreen** | `/privacy-policy` | Static Content + In-App Legal Text | None | Embedded in Flutter assets with support email `support@studymate.ai` | Offline static asset rendering | None | `PrivacyPolicyScreen` |

---

## 3. Integration Verification & Quality Gates

All checks have been executed and verified in both projects:

| Gate | Scope | Command | Result |
| :--- | :--- | :--- | :--- |
| **Backend Lint & Static Analysis** | Backend (`src/`) | `npm.cmd run lint` | Pass (0 errors) |
| **Backend TypeScript Build** | Backend (`tsc`) | `npm.cmd run build` | Pass (0 errors) |
| **Backend Unit & Contract Tests** | Backend (`vitest`) | `npm.cmd test` | **18/18 test files passed** (209/209 tests passed) |
| **Backend Production CORS Check** | Backend (`envSchema`) | `vitest run src/tests/env.test.ts` | Pass (Wildcard `*` rejected in production) |
| **Flutter Static Analysis** | Frontend (`lib/`, `test/`) | `flutter analyze` | **Pass (0 issues found)** |
| **Flutter Full Test Suite** | Frontend (`test/`) | `flutter test` | **206/206 tests passed** |
| **Flutter Live & Offline Probes** | Frontend (`network/`) | `flutter test test/integration/backend_live_connection_test.dart` | Pass (2/2 tests passed) |
| **Flutter Health & Error Mapping** | Frontend (`network/`) | `flutter test test/unit/health_and_api_foundation_test.dart` | Pass (10/10 tests passed) |
