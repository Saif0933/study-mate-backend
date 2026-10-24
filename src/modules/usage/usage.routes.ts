import { Router } from "express";
import { usageController } from "./usage.controller";
import { authenticate } from "../../middleware/authenticate";

export const usageRouter = Router();

// GET /api/v1/usage
usageRouter.get("/", authenticate, usageController.getUsage);

// POST /api/v1/usage/feedback (alias)
usageRouter.post("/feedback", authenticate, usageController.submitFeedback);

export const feedbackRouter = Router();

// POST /api/v1/feedback
feedbackRouter.post("/", authenticate, usageController.submitFeedback);
