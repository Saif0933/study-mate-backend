import { Router } from "express";
import { authController } from "../modules/auth/auth.controller";
import { usageController } from "../modules/usage/usage.controller";
import { authenticate } from "../middleware/authenticate";

export const meRouter = Router();

// GET /api/v1/me
meRouter.get("/", authenticate, authController.getMe);

// PATCH /api/v1/me
meRouter.patch("/", authenticate, authController.updateProfile);

// DELETE /api/v1/me
meRouter.delete("/", authenticate, authController.deleteAccount);

// GET /api/v1/me/usage (alias to /api/v1/usage)
meRouter.get("/usage", authenticate, usageController.getUsage);
