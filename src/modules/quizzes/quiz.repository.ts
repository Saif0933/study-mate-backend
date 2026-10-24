import { prisma } from "../../config/prisma";
import { Quiz, QuizQuestion, QuizAttempt, QuizResponse } from "../../generated/prisma/client";
import { QuizDifficulty, AttemptStatus, AIRequestFeature, AIRequestStatus } from "../../generated/prisma/enums";
import { calculateEstimatedCost } from "../../utils/cost-calculator";

export interface CreateQuizWithQuestionsData {
  id?: string;
  userId: string;
  title: string;
  topic?: string | null;
  sourceDocumentId?: string | null;
  difficulty: QuizDifficulty;
  questionCount: number;
  status?: string;
  questions: Array<{
    id?: string;
    orderIndex: number;
    prompt: string;
    options: string[];
    correctAnswer: string;
    explanation?: string | null;
  }>;
}

export interface SubmitAttemptData {
  attemptId: string;
  score: number;
  responses: Array<{
    id?: string;
    questionId: string;
    selectedAnswer: string | null;
    isCorrect: boolean;
  }>;
}

export interface RecordQuizUsageData {
  userId: string;
  requestId: string;
  modelId: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  status: AIRequestStatus;
  errorCode?: string;
}

export type QuizWithQuestions = Quiz & {
  questions: QuizQuestion[];
};

export type AttemptWithDetails = QuizAttempt & {
  quiz: QuizWithQuestions;
  responses: QuizResponse[];
};

export class QuizRepository {
  /**
   * Creates a quiz and all its questions inside a single atomic database transaction.
   */
  async createQuizWithQuestions(data: CreateQuizWithQuestionsData): Promise<QuizWithQuestions> {
    return prisma.$transaction(async (tx) => {
      const quiz = await tx.quiz.create({
        data: {
          id: data.id,
          userId: data.userId,
          title: data.title,
          topic: data.topic,
          sourceDocumentId: data.sourceDocumentId,
          difficulty: data.difficulty,
          questionCount: data.questionCount,
          status: data.status || "READY",
        },
      });

      const questionsToInsert = data.questions.map((q) => ({
        id: q.id,
        quizId: quiz.id,
        orderIndex: q.orderIndex,
        prompt: q.prompt,
        options: q.options,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation || null,
      }));

      await tx.quizQuestion.createMany({
        data: questionsToInsert,
      });

      const fullQuestions = await tx.quizQuestion.findMany({
        where: { quizId: quiz.id },
        orderBy: { orderIndex: "asc" },
      });

      return {
        ...quiz,
        questions: fullQuestions,
      };
    });
  }

  /**
   * Finds a quiz by ID including questions ordered by orderIndex.
   */
  async findById(quizId: string): Promise<QuizWithQuestions | null> {
    return prisma.quiz.findUnique({
      where: { id: quizId },
      include: {
        questions: {
          orderBy: { orderIndex: "asc" },
        },
      },
    });
  }

  /**
   * Finds all non-deleted quizzes for a user ordered by createdAt descending.
   */
  async findByUserId(userId: string): Promise<Quiz[]> {
    return prisma.quiz.findMany({
      where: {
        userId,
        deletedAt: null,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Creates a new quiz attempt with IN_PROGRESS status.
   */
  async createAttempt(data: {
    id?: string;
    quizId: string;
    userId: string;
    totalQuestions: number;
  }): Promise<QuizAttempt> {
    return prisma.quizAttempt.create({
      data: {
        id: data.id,
        quizId: data.quizId,
        userId: data.userId,
        status: AttemptStatus.IN_PROGRESS,
        totalQuestions: data.totalQuestions,
      },
    });
  }

  /**
   * Finds a quiz attempt by ID with full quiz, questions, and responses.
   */
  async findAttemptById(attemptId: string): Promise<AttemptWithDetails | null> {
    return prisma.quizAttempt.findUnique({
      where: { id: attemptId },
      include: {
        quiz: {
          include: {
            questions: {
              orderBy: { orderIndex: "asc" },
            },
          },
        },
        responses: true,
      },
    });
  }

  /**
   * Finds all attempts for a quiz by the given user.
   */
  async findAttemptsByQuizId(quizId: string, userId: string): Promise<QuizAttempt[]> {
    return prisma.quizAttempt.findMany({
      where: {
        quizId,
        userId,
      },
      orderBy: { startedAt: "desc" },
    });
  }

  /**
   * Atomically records user responses and finalizes score in a single database transaction.
   */
  async submitAttempt(data: SubmitAttemptData): Promise<AttemptWithDetails> {
    return prisma.$transaction(async (tx) => {
      // 1. Delete previous responses if any (for idempotent resubmission safety)
      await tx.quizResponse.deleteMany({
        where: { attemptId: data.attemptId },
      });

      // 2. Insert validated responses
      if (data.responses.length > 0) {
        await tx.quizResponse.createMany({
          data: data.responses.map((r) => ({
            id: r.id,
            attemptId: data.attemptId,
            questionId: r.questionId,
            selectedAnswer: r.selectedAnswer,
            isCorrect: r.isCorrect,
          })),
        });
      }

      // 3. Finalize attempt status and score
      await tx.quizAttempt.update({
        where: { id: data.attemptId },
        data: {
          status: AttemptStatus.SUBMITTED,
          score: data.score,
          submittedAt: new Date(),
        },
      });

      const updated = await tx.quizAttempt.findUniqueOrThrow({
        where: { id: data.attemptId },
        include: {
          quiz: {
            include: {
              questions: {
                orderBy: { orderIndex: "asc" },
              },
            },
          },
          responses: true,
        },
      });

      return updated;
    });
  }

  /**
   * Records AI Usage entry for Quiz Generation requests.
   */
  async recordUsage(data: RecordQuizUsageData): Promise<void> {
    await prisma.aIUsage.create({
      data: {
        userId: data.userId,
        requestId: data.requestId,
        feature: AIRequestFeature.QUIZ_GENERATION,
        provider: "openai",
        modelId: data.modelId,
        status: data.status,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        latencyMs: data.latencyMs,
        estimatedCost: calculateEstimatedCost(data.modelId, data.inputTokens, data.outputTokens),
        errorCode: data.errorCode,
      },
    });
  }
}

export const quizRepository = new QuizRepository();
