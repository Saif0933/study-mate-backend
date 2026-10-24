import { Request, Response, NextFunction } from "express";
import { authService, AuthService } from "./auth.service";
import {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "./auth.validators";
import { updateProfileSchema } from "../usage/usage.validators";

export class AuthController {
  constructor(private readonly service: AuthService = authService) {}

  register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const validated = registerSchema.parse(req.body);
      const session = await this.service.register(validated);
      res.status(201).json(session);
    } catch (error) {
      next(error);
    }
  };

  login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const validated = loginSchema.parse(req.body);
      const session = await this.service.login(validated);
      res.status(200).json(session);
    } catch (error) {
      next(error);
    }
  };

  refresh = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const validated = refreshTokenSchema.parse(req.body);
      const result = await this.service.refreshSession(validated.refreshToken);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  forgotPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const validated = forgotPasswordSchema.parse(req.body);
      const result = await this.service.forgotPassword(validated);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  resetPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const validated = resetPasswordSchema.parse(req.body);
      const result = await this.service.resetPassword(validated);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  logout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const refreshToken = typeof req.body?.refreshToken === "string" ? req.body.refreshToken : undefined;
      const result = await this.service.logout(refreshToken);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  getMe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.id;
      const user = await this.service.getMe(userId);
      res.status(200).json(user);
    } catch (error) {
      next(error);
    }
  };

  updateProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.id;
      const validated = updateProfileSchema.parse(req.body);
      const user = await this.service.updateProfile(userId, validated);
      res.status(200).json(user);
    } catch (error) {
      next(error);
    }
  };

  deleteAccount = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.id;
      const { password, confirmation } = req.body ?? {};
      const result = await this.service.deleteAccount(userId, { password, confirmation });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}

export const authController = new AuthController();
