import { Router } from "express";
import { authController } from "./auth.controller";
import { authenticate } from "../../middleware/authenticate";
import { authRateLimiter, forgotPasswordRateLimiter } from "../../middleware/rate-limit";

export const authRouter = Router();

// Public Authentication endpoints with rate limiting
authRouter.post("/register", authRateLimiter, authController.register);
authRouter.post("/login", authRateLimiter, authController.login);
authRouter.post("/session", authRateLimiter, authController.login); // Frontend compatibility alias
authRouter.post("/refresh", authRateLimiter, authController.refresh);
authRouter.post("/forgot-password", forgotPasswordRateLimiter, authController.forgotPassword);
authRouter.post("/reset-password", authRateLimiter, authController.resetPassword);
authRouter.post("/logout", authController.logout);

// Protected Auth/Profile endpoints
authRouter.get("/me", authenticate, authController.getMe);
authRouter.delete("/me", authenticate, authController.deleteAccount);
