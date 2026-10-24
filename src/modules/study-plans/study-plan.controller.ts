import { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { studyPlanService, StudyPlanService } from "./study-plan.service";
import {
  createStudyPlanSchema,
  updateStudyPlanSchema,
  regenerateStudyPlanSchema,
  updateStudyTaskSchema,
  createStudyTaskSchema,
  planIdParamSchema,
  taskIdParamSchema,
} from "./study-plan.validators";

export class StudyPlanController {
  constructor(private readonly service: StudyPlanService = studyPlanService) {}

  /**
   * POST /api/v1/study-plans
   * Generates a tailored study plan with structured daily tasks.
   */
  createStudyPlan = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const validated = createStudyPlanSchema.parse(req.body);
      const requestId = req.id ? String(req.id) : uuidv4();
      const result = await this.service.createStudyPlan(req.user!.id, validated, requestId);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/v1/study-plans
   * Lists all study plans owned by authenticated user.
   */
  getStudyPlans = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const result = await this.service.getStudyPlans(req.user!.id);
      res.status(200).json({ studyPlans: result });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/v1/study-plans/:id
   * Retrieves single study plan with its tasks.
   */
  getStudyPlan = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { id } = planIdParamSchema.parse(req.params);
      const result = await this.service.getStudyPlanById(req.user!.id, id);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * PATCH /api/v1/study-plans/:id
   * Updates study plan metadata.
   */
  updateStudyPlan = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { id } = planIdParamSchema.parse(req.params);
      const validated = updateStudyPlanSchema.parse(req.body);
      const result = await this.service.updateStudyPlan(req.user!.id, id, validated);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * DELETE /api/v1/study-plans/:id
   * Soft deletes a study plan.
   */
  deleteStudyPlan = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { id } = planIdParamSchema.parse(req.params);
      await this.service.deleteStudyPlan(req.user!.id, id);
      res.status(200).json({ message: "Study plan deleted successfully" });
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/v1/study-plans/:id/regenerate
   * Regenerates tasks while preserving completed tasks.
   */
  regenerateStudyPlan = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { id } = planIdParamSchema.parse(req.params);
      const validated = regenerateStudyPlanSchema.parse(req.body);
      const requestId = req.id ? String(req.id) : uuidv4();
      const result = await this.service.regenerateStudyPlan(
        req.user!.id,
        id,
        validated,
        requestId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/v1/study-plans/:id/tasks
   * Adds a custom task to a plan.
   */
  createTask = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { id } = planIdParamSchema.parse(req.params);
      const validated = createStudyTaskSchema.parse(req.body);
      const result = await this.service.createTask(req.user!.id, id, validated);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * PATCH /api/v1/study-tasks/:id
   * Updates task status or details.
   */
  updateTask = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { id } = taskIdParamSchema.parse(req.params);
      const validated = updateStudyTaskSchema.parse(req.body);
      const result = await this.service.updateTask(req.user!.id, id, validated);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * DELETE /api/v1/study-tasks/:id
   * Deletes a study task.
   */
  deleteTask = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { id } = taskIdParamSchema.parse(req.params);
      await this.service.deleteTask(req.user!.id, id);
      res.status(200).json({ message: "Study task deleted successfully" });
    } catch (error) {
      next(error);
    }
  };
}

export const studyPlanController = new StudyPlanController();
