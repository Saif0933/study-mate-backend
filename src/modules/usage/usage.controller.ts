import { Request, Response, NextFunction } from "express";
import { usageService, UsageService } from "./usage.service";
import { submitFeedbackSchema } from "./usage.validators";

export class UsageController {
  constructor(private readonly service: UsageService = usageService) {}

  /**
   * Retrieves usage summary, actual token metrics, and quota status.
   */
  getUsage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.id;
      const usage = await this.service.getUsage(userId);
      res.status(200).json(usage);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Submits user feedback for an AI response.
   */
  submitFeedback = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.id;
      const validated = submitFeedbackSchema.parse(req.body);
      const result = await this.service.submitFeedback(userId, validated);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  };
}

export const usageController = new UsageController();
