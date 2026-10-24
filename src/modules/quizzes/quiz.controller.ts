import { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { quizService, QuizService } from "./quiz.service";
import {
  createQuizSchema,
  quizIdParamSchema,
  attemptIdParamSchema,
  submitAttemptSchema,
} from "./quiz.validators";

export class QuizController {
  constructor(private readonly service: QuizService = quizService) {}

  /**
   * POST /api/v1/quizzes
   * Generates a new quiz from topic or source document.
   */
  createQuiz = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const validated = createQuizSchema.parse(req.body);
      const requestId = req.id ? String(req.id) : uuidv4();
      const result = await this.service.createQuiz(req.user!.id, validated, requestId);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/v1/quizzes
   * Lists all quizzes owned by the authenticated user.
   */
  getQuizzes = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const result = await this.service.getQuizzes(req.user!.id);
      res.status(200).json({ quizzes: result });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/v1/quizzes/:id
   * Retrieves single quiz metadata.
   */
  getQuiz = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { id } = quizIdParamSchema.parse(req.params);
      const result = await this.service.getQuizById(req.user!.id, id);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/v1/quizzes/:id/attempts
   * Starts an attempt, returning questions with masked answers.
   */
  startAttempt = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { id } = quizIdParamSchema.parse(req.params);
      const result = await this.service.startAttempt(req.user!.id, id);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/v1/quizzes/:id/attempts
   * Lists past attempts for this quiz.
   */
  getQuizAttempts = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { id } = quizIdParamSchema.parse(req.params);
      const result = await this.service.getQuizAttempts(req.user!.id, id);
      res.status(200).json({ attempts: result });
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/v1/quiz-attempts/:id/submit
   * Submits user answers and returns server-calculated score and review.
   */
  submitAttempt = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { id } = attemptIdParamSchema.parse(req.params);
      const validated = submitAttemptSchema.parse(req.body);
      const result = await this.service.submitAttempt(req.user!.id, id, validated);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/v1/quiz-attempts/:id
   * Fetches attempt results and review.
   */
  getAttempt = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { id } = attemptIdParamSchema.parse(req.params);
      const result = await this.service.getAttempt(req.user!.id, id);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}

export const quizController = new QuizController();
