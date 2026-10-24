import { v4 as uuidv4 } from "uuid";
import { Quiz } from "../../generated/prisma/client";
import { QuizDifficulty, AttemptStatus, AIRequestStatus } from "../../generated/prisma/enums";
import { quizRepository, QuizRepository } from "./quiz.repository";
import { documentRepository, DocumentRepository } from "../documents/document.repository";
import { quizGeneratorGraph } from "../../ai/graphs/quiz-generator.graph";
import { prisma } from "../../config/prisma";
import { logger } from "../../utils/logger";
import { BadRequestError, NotFoundError } from "../../utils/errors";
import {
  QuizResponseModel,
  QuizAttemptResponseModel,
  QuizQuestionResponseModel,
  QuizSubmissionResultModel,
  QuestionReviewItemModel,
} from "../../types/quiz";
import { CreateQuizInput, SubmitAttemptInput } from "./quiz.validators";
import { usageService } from "../usage/usage.service";

export class QuizService {
  constructor(
    private readonly repo: QuizRepository = quizRepository,
    private readonly docRepo: DocumentRepository = documentRepository
  ) {}

  /**
   * Serializes a Quiz entity into client response model.
   */
  sanitizeQuiz(quiz: Quiz): QuizResponseModel {
    return {
      id: quiz.id,
      title: quiz.title,
      topic: quiz.topic,
      difficulty: quiz.difficulty as "EASY" | "MEDIUM" | "HARD",
      questionCount: quiz.questionCount,
      status: quiz.status,
      sourceDocumentId: quiz.sourceDocumentId,
      createdAt: quiz.createdAt.toISOString(),
    };
  }

  /**
   * Generates a new quiz from a topic or a ready PDF document via LangGraph workflow.
   */
  async createQuiz(
    userId: string,
    input: CreateQuizInput,
    requestId: string
  ): Promise<QuizResponseModel> {
    // 0. Enforce AI usage quota before invocation
    await usageService.checkQuota(userId);

    let documentContext: string | undefined;

    // 1. If generating from a source document, verify ownership and READY status
    if (input.sourceDocumentId) {
      const doc = await this.docRepo.findById(input.sourceDocumentId);
      if (!doc || doc.userId !== userId || doc.status === "DELETED") {
        throw new NotFoundError("Source document not found");
      }

      if (doc.status !== "READY") {
        throw new BadRequestError(
          `Source document is not ready for quiz generation (current status: ${doc.status})`
        );
      }

      // Load representative excerpts from document chunks
      const chunks = await prisma.documentChunk.findMany({
        where: { documentId: doc.id },
        take: 12,
        orderBy: { chunkIndex: "asc" },
        select: { text: true },
      });

      if (chunks.length > 0) {
        documentContext = chunks.map((c) => c.text).join("\n\n");
      }
    }

    // 2. Determine quiz title
    const fallbackTitle = input.topic
      ? `${input.topic.trim()} Quiz`
      : input.sourceDocumentId
      ? "Document Review Quiz"
      : "Practice Quiz";
    const title = input.title && input.title.trim().length > 0 ? input.title.trim() : fallbackTitle;

    // 3. Invoke LangGraph Quiz Generator workflow
    const difficultyEnum = input.difficulty as QuizDifficulty;
    const result = await quizGeneratorGraph.invoke({
      topic: input.topic,
      documentContext,
      difficulty: input.difficulty,
      questionCount: input.questionCount,
    });

    if (!result.questions || result.questions.length === 0) {
      throw new BadRequestError("Failed to generate quiz questions for the given input.");
    }

    // 4. Save quiz and questions transactionally
    const quizId = uuidv4();
    const created = await this.repo.createQuizWithQuestions({
      id: quizId,
      userId,
      title,
      topic: input.topic || null,
      sourceDocumentId: input.sourceDocumentId || null,
      difficulty: difficultyEnum,
      questionCount: result.questions.length,
      status: "READY",
      questions: result.questions.map((q) => ({
        id: uuidv4(),
        orderIndex: q.orderIndex,
        prompt: q.prompt,
        options: q.options,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation,
      })),
    });

    // 5. Record AI Usage
    try {
      await this.repo.recordUsage({
        userId,
        requestId,
        modelId: result.modelId || "gpt-4o",
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: result.latencyMs,
        status: AIRequestStatus.SUCCESS,
      });
    } catch (usageErr) {
      logger.warn({ err: (usageErr as Error).message }, "Failed to record AI usage for quiz generation");
    }

    logger.info(
      { quizId: created.id, userId, questionCount: created.questionCount },
      "Quiz successfully generated and persisted"
    );

    return this.sanitizeQuiz(created);
  }

  /**
   * Retrieves all non-deleted quizzes for the authenticated user.
   */
  async getQuizzes(userId: string): Promise<QuizResponseModel[]> {
    const quizzes = await this.repo.findByUserId(userId);
    return quizzes.map((q) => this.sanitizeQuiz(q));
  }

  /**
   * Retrieves a specific quiz by ID, strictly verifying ownership.
   */
  async getQuizById(userId: string, quizId: string): Promise<QuizResponseModel> {
    const quiz = await this.repo.findById(quizId);
    if (!quiz || quiz.userId !== userId || quiz.deletedAt) {
      throw new NotFoundError("Quiz not found");
    }
    return this.sanitizeQuiz(quiz);
  }

  /**
   * Starts a new attempt for a quiz, returning questions with correct answers masked.
   */
  async startAttempt(userId: string, quizId: string): Promise<QuizAttemptResponseModel> {
    const quiz = await this.repo.findById(quizId);
    if (!quiz || quiz.userId !== userId || quiz.deletedAt) {
      throw new NotFoundError("Quiz not found");
    }

    if (!quiz.questions || quiz.questions.length === 0) {
      throw new BadRequestError("This quiz has no questions available to take.");
    }

    const attemptId = uuidv4();
    const attempt = await this.repo.createAttempt({
      id: attemptId,
      quizId: quiz.id,
      userId,
      totalQuestions: quiz.questions.length,
    });

    // CRITICAL: Mask correctAnswer and explanation during active attempt
    const maskedQuestions: QuizQuestionResponseModel[] = quiz.questions.map((q) => ({
      id: q.id,
      orderIndex: q.orderIndex,
      prompt: q.prompt,
      options: (q.options as string[]) || [],
      // correctAnswer is intentionally omitted
      // explanation is intentionally omitted
    }));

    return {
      id: attempt.id,
      quizId: attempt.quizId,
      status: "IN_PROGRESS",
      score: null,
      totalQuestions: quiz.questions.length,
      startedAt: attempt.startedAt.toISOString(),
      submittedAt: null,
      questions: maskedQuestions,
    };
  }

  /**
   * Submits responses for a quiz attempt, calculates score on the server, and returns review.
   */
  async submitAttempt(
    userId: string,
    attemptId: string,
    input: SubmitAttemptInput
  ): Promise<QuizSubmissionResultModel> {
    const attempt = await this.repo.findAttemptById(attemptId);
    if (!attempt || attempt.userId !== userId) {
      throw new NotFoundError("Quiz attempt not found");
    }

    const questions = attempt.quiz.questions;
    const questionsMap = new Map(questions.map((q) => [q.id, q]));

    // Idempotency: If attempt was already submitted, return the existing score and review
    if (attempt.status === AttemptStatus.SUBMITTED) {
      const existingReview: QuestionReviewItemModel[] = questions.map((q) => {
        const resp = attempt.responses.find((r) => r.questionId === q.id);
        return {
          questionId: q.id,
          prompt: q.prompt,
          selectedAnswer: resp?.selectedAnswer || null,
          correctAnswer: q.correctAnswer,
          isCorrect: Boolean(resp?.isCorrect),
          explanation: q.explanation,
        };
      });

      return {
        attemptId: attempt.id,
        score: attempt.score ?? 0,
        totalQuestions: attempt.totalQuestions,
        review: existingReview,
      };
    }

    // Validate that all submitted question IDs belong to this quiz
    for (const r of input.responses) {
      if (!questionsMap.has(r.questionId)) {
        throw new BadRequestError(`Question with ID ${r.questionId} does not belong to this quiz.`);
      }
    }

    // Calculate score on the server using stored answer keys
    let score = 0;
    const userResponsesMap = new Map(
      input.responses.map((r) => [r.questionId, r.selectedAnswer ? r.selectedAnswer.trim() : null])
    );

    const responsesToPersist: Array<{
      id: string;
      questionId: string;
      selectedAnswer: string | null;
      isCorrect: boolean;
    }> = [];

    const reviewItems: QuestionReviewItemModel[] = [];

    for (const q of questions) {
      const selected = userResponsesMap.get(q.id) ?? null;
      const isCorrect = Boolean(
        selected && selected.toLowerCase() === q.correctAnswer.trim().toLowerCase()
      );

      if (isCorrect) {
        score++;
      }

      responsesToPersist.push({
        id: uuidv4(),
        questionId: q.id,
        selectedAnswer: selected,
        isCorrect,
      });

      reviewItems.push({
        questionId: q.id,
        prompt: q.prompt,
        selectedAnswer: selected,
        correctAnswer: q.correctAnswer,
        isCorrect,
        explanation: q.explanation,
      });
    }

    // Transactionally finalize submission
    await this.repo.submitAttempt({
      attemptId,
      score,
      responses: responsesToPersist,
    });

    logger.info(
      { attemptId, userId, score, totalQuestions: questions.length },
      "Quiz attempt submitted and scored"
    );

    return {
      attemptId,
      score,
      totalQuestions: questions.length,
      review: reviewItems,
    };
  }

  /**
   * Retrieves past attempt results and review, verifying ownership.
   */
  async getAttempt(userId: string, attemptId: string): Promise<QuizSubmissionResultModel> {
    const attempt = await this.repo.findAttemptById(attemptId);
    if (!attempt || attempt.userId !== userId) {
      throw new NotFoundError("Quiz attempt not found");
    }

    const questions = attempt.quiz.questions;
    const reviewItems: QuestionReviewItemModel[] = questions.map((q) => {
      const resp = attempt.responses.find((r) => r.questionId === q.id);
      return {
        questionId: q.id,
        prompt: q.prompt,
        selectedAnswer: resp?.selectedAnswer || null,
        correctAnswer: q.correctAnswer,
        isCorrect: Boolean(resp?.isCorrect),
        explanation: q.explanation,
      };
    });

    return {
      attemptId: attempt.id,
      score: attempt.score ?? 0,
      totalQuestions: attempt.totalQuestions,
      review: reviewItems,
    };
  }

  /**
   * Lists all attempts for a given quiz owned by the user.
   */
  async getQuizAttempts(userId: string, quizId: string): Promise<QuizAttemptResponseModel[]> {
    const quiz = await this.repo.findById(quizId);
    if (!quiz || quiz.userId !== userId || quiz.deletedAt) {
      throw new NotFoundError("Quiz not found");
    }

    const attempts = await this.repo.findAttemptsByQuizId(quizId, userId);

    return attempts.map((a) => ({
      id: a.id,
      quizId: a.quizId,
      status: a.status as "IN_PROGRESS" | "SUBMITTED" | "ABANDONED",
      score: a.score,
      totalQuestions: a.totalQuestions,
      startedAt: a.startedAt.toISOString(),
      submittedAt: a.submittedAt ? a.submittedAt.toISOString() : null,
      questions: [],
    }));
  }
}

export const quizService = new QuizService();
