import { Request, Response, NextFunction } from "express";
import { authService } from "../modules/auth/auth.service";
import { authRepository } from "../modules/auth/auth.repository";
import { UnauthorizedError, ForbiddenError } from "../utils/errors";
import { UserStatus } from "../generated/prisma/enums";

/**
 * Authentication middleware.
 * Verifies JWT Bearer token, enforces active account status,
 * and attaches verified user identity to req.user.
 */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers["authorization"];
    if (!authHeader || typeof authHeader !== "string") {
      throw new UnauthorizedError("Authentication required. Please provide a Bearer token.");
    }

    const [scheme, token] = authHeader.split(" ");
    if (scheme?.toLowerCase() !== "bearer" || !token) {
      throw new UnauthorizedError("Malformed Authorization header. Format: Bearer <token>");
    }

    const payload = authService.verifyAccessToken(token);

    // Verify user exists in database and is ACTIVE
    const user = await authRepository.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedError("User session is invalid or user no longer exists");
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenError("Your account is inactive or scheduled for deletion.");
    }

    req.user = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      status: user.status,
    };

    next();
  } catch (error) {
    next(error);
  }
}
