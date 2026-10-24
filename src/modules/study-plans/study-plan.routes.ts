import { Router } from "express";
import { studyPlanController } from "./study-plan.controller";
import { authenticate } from "../../middleware/authenticate";
import { messageRateLimiter } from "../../middleware/rate-limit";

// 1. Study Plans Router mounted at /study-plans
export const studyPlanRouter = Router();

studyPlanRouter.use(authenticate);

studyPlanRouter.post("/", messageRateLimiter, studyPlanController.createStudyPlan);
studyPlanRouter.get("/", studyPlanController.getStudyPlans);
studyPlanRouter.get("/:id", studyPlanController.getStudyPlan);
studyPlanRouter.patch("/:id", studyPlanController.updateStudyPlan);
studyPlanRouter.delete("/:id", studyPlanController.deleteStudyPlan);
studyPlanRouter.post("/:id/regenerate", messageRateLimiter, studyPlanController.regenerateStudyPlan);
studyPlanRouter.post("/:id/tasks", studyPlanController.createTask);

// 2. Study Tasks Router mounted at /study-tasks
export const studyTaskRouter = Router();

studyTaskRouter.use(authenticate);

studyTaskRouter.patch("/:id", studyPlanController.updateTask);
studyTaskRouter.delete("/:id", studyPlanController.deleteTask);
