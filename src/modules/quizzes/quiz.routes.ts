import { Router } from "express";
import { quizController } from "./quiz.controller";
import { authenticate } from "../../middleware/authenticate";
import { messageRateLimiter } from "../../middleware/rate-limit";

// 1. Quizzes Router mounted at /quizzes
export const quizRouter = Router();

quizRouter.use(authenticate);

quizRouter.post("/", messageRateLimiter, quizController.createQuiz);
quizRouter.get("/", quizController.getQuizzes);
quizRouter.get("/:id", quizController.getQuiz);
quizRouter.post("/:id/attempts", quizController.startAttempt);
quizRouter.get("/:id/attempts", quizController.getQuizAttempts);

// 2. Quiz Attempts Router mounted at /quiz-attempts
export const quizAttemptRouter = Router();

quizAttemptRouter.use(authenticate);

quizAttemptRouter.post("/:id/submit", quizController.submitAttempt);
quizAttemptRouter.get("/:id", quizController.getAttempt);
