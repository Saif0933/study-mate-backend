# AI StudyMate — Flutter Mobile Client & Android Release Integration

This document verifies the API integration contracts between the **AI StudyMate Flutter Android client** and the production backend, confirms that no secrets exist on the client, and outlines Android release readiness.

---

## 1. Zero-Secret Verification (Android Client)

A code audit of `study_mate_frontend/` confirmed that **zero backend secrets, database passwords, or OpenAI API keys reside on the mobile client**:
- The Flutter client communicates solely with the backend via REST endpoints (`/api/v1/*`).
- OpenAI API calls and LangChain/LangGraph pipelines execute exclusively on the backend.
- Student authentication tokens are stored using `flutter_secure_storage` (Android Keystore / EncryptedSharedPreferences).
- The only mention of OpenAI in the client is in `privacy_policy_screen.dart` explaining that provider secrets never reside on device.

---

## 2. API Contract Verification Summary

All endpoints expected by the Flutter frontend repositories have been verified and tested against the backend:

| Flutter Repository | Backend Endpoint | HTTP Method | Verified Contract |
| :--- | :--- | :--- | :--- |
| **AuthRepository** | `/api/v1/auth/register` | `POST` | Returns `{ token, accessToken, user: { id, email, displayName } }` |
| **AuthRepository** | `/api/v1/auth/session` | `POST` | Session alias returning identical login payload |
| **AuthRepository** | `/api/v1/auth/login` | `POST` | Standard login endpoint |
| **AuthRepository** | `/api/v1/auth/refresh` | `POST` | Refresh token rotation with reuse detection |
| **AuthRepository** | `/api/v1/auth/forgot-password` | `POST` | Password reset email trigger |
| **AuthRepository** | `/api/v1/auth/reset-password` | `POST` | Token verification & password reset |
| **ChatRepository** | `/api/v1/conversations` | `GET`, `POST` | List conversations and start new chat session |
| **ChatRepository** | `/api/v1/conversations/:id` | `GET` | Single conversation metadata retrieval |
| **ChatRepository** | `/api/v1/conversations/:id/messages` | `POST` | Send message with mode selection and prompt bounds |
| **DocumentRepository**| `/api/v1/documents` | `GET`, `POST` | Multipart upload with magic byte check (`%PDF-`) |
| **DocumentRepository**| `/api/v1/documents/:id/questions` | `POST` | Document Q&A with pgvector citations |
| **QuizRepository** | `/api/v1/quizzes` | `GET`, `POST` | Quiz generation with 4 options per question |
| **QuizRepository** | `/api/v1/quizzes/:id/attempts` | `POST` | Start attempt with hidden answer keys |
| **QuizRepository** | `/api/v1/quiz-attempts/:id/submit`| `POST` | Server-side scoring returning `{ attemptId, score, review }` |
| **StudyPlanRepository**| `/api/v1/study-plans` | `GET`, `POST` | Study plan generation with structured tasks |
| **StudyPlanRepository**| `/api/v1/study-tasks/:id` | `PATCH` | Update task status (`TODO` -> `COMPLETED`) |
| **UsageRepository** | `/api/v1/me/usage` | `GET` | Matches `UsageModel` with `totalTokens`, `requestCount`, etc. |
| **FeedbackRepository**| `/api/v1/feedback` | `POST` | Rating, category, and comment submission |
| **SettingsRepository**| `/api/v1/me` | `DELETE` | Re-authenticated account deletion with password verification |

---

## 3. Production Mobile Build Instructions

When building the Flutter Android release bundle (`.aab`) or APK, inject the production API endpoint using `--dart-define`:

```bash
cd study_mate_frontend

# Build Android App Bundle (AAB) for Google Play release:
flutter build appbundle --release \
  --dart-define=API_BASE_URL=https://api.studymate.ai/api/v1

# Or build release APK for internal staging distribution:
flutter build apk --release \
  --dart-define=API_BASE_URL=https://staging-api.studymate.ai/api/v1
```

---

## 4. Android Security & Release Configuration

### A. Network Security Configuration (`network_security_config.xml`)
Ensure cleartext HTTP traffic is disabled in production:
```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
</network-security-config>
```

### B. ProGuard / R8 Obfuscation Rules (`proguard-rules.pro`)
Keep serialized JSON data model classes from being stripped or corrupted during minification:
```pro
# Preserve model classes for Dio serialization
-keep class com.studymate.models.** { *; }
-keepclassmembers class * {
    @com.google.gson.annotations.SerializedName <fields>;
}
```

### C. Play Store Release Pre-Flight Checklist
- [x] Backend deployed to production with valid SSL certificate (`https://`).
- [x] Zero backend secrets / OpenAI keys in the Flutter codebase.
- [x] Deep readiness check verified (`GET /health/ready` returns 200).
- [x] Re-authentication required for destructive account deletion (`DELETE /api/v1/me`).
- [x] Privacy policy and Terms of service URLs active (`https://studymate.ai/privacy`).
- [x] Mobile app builds cleanly with `--dart-define=API_BASE_URL=https://api.studymate.ai/api/v1`.
