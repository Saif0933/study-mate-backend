import { Router } from "express";
import { healthRouter } from "./health.routes";
import { authRouter } from "../modules/auth/auth.routes";
import { meRouter } from "./me.routes";
import { conversationRouter } from "../modules/conversations/conversation.routes";
import { documentRouter } from "../modules/documents/document.routes";
import { quizRouter, quizAttemptRouter } from "../modules/quizzes/quiz.routes";
import { studyPlanRouter, studyTaskRouter } from "../modules/study-plans/study-plan.routes";
import { usageRouter, feedbackRouter } from "../modules/usage/usage.routes";

export const apiRouter = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/me", meRouter);
apiRouter.use("/conversations", conversationRouter);
apiRouter.use("/documents", documentRouter);
apiRouter.use("/quizzes", quizRouter);
apiRouter.use("/quiz-attempts", quizAttemptRouter);
apiRouter.use("/study-plans", studyPlanRouter);
apiRouter.use("/study-tasks", studyTaskRouter);
apiRouter.use("/usage", usageRouter);
apiRouter.use("/feedback", feedbackRouter);

export * from "./health.routes";
export * from "./me.routes";
export * from "../modules/conversations/conversation.routes";
export * from "../modules/documents/document.routes";
export * from "../modules/quizzes/quiz.routes";
export * from "../modules/study-plans/study-plan.routes";
export * from "../modules/usage/usage.routes";
