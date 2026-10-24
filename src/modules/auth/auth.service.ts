import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { authRepository, AuthRepository } from "./auth.repository";
import {
  RegisterInput,
  LoginInput,
  ForgotPasswordInput,
  ResetPasswordInput,
} from "./auth.validators";
import { getEnv } from "../../config/env";
import {
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
  BadRequestError,
} from "../../utils/errors";
import { User } from "../../generated/prisma/client";
import { UserStatus } from "../../generated/prisma/enums";
import { AuthSessionResponse, UserResponse } from "../../types/auth";
import { logger } from "../../utils/logger";
import { fileStorageService } from "../../utils/file-storage";
import { UpdateProfileInput } from "../usage/usage.validators";

const BCRYPT_SALT_ROUNDS = 12;
const RESET_TOKEN_EXPIRY_HOURS = 1;
const REFRESH_TOKEN_EXPIRY_DAYS = 30;
const JWT_ISSUER = "ai-studymate";
const JWT_AUDIENCE = "ai-studymate-users";

export class AuthService {
  constructor(private readonly repo: AuthRepository = authRepository) {}

  /**
   * Hashes a password using bcrypt with 12 salt rounds.
   */
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
  }

  /**
   * Verifies a password against a hash.
   */
  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Generates a signed JWT access token.
   */
  generateAccessToken(user: { id: string; email: string; status: UserStatus }): string {
    const env = getEnv();
    return jwt.sign(
      {
        sub: user.id,
        email: user.email,
        status: user.status,
      },
      env.JWT_SECRET,
      {
        expiresIn: (env.JWT_EXPIRES_IN || "7d") as jwt.SignOptions["expiresIn"],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      }
    );
  }

  /**
   * Verifies a JWT access token.
   */
  verifyAccessToken(token: string): { sub: string; email: string; status: UserStatus } {
    const env = getEnv();
    try {
      return jwt.verify(token, env.JWT_SECRET, {
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      }) as { sub: string; email: string; status: UserStatus };
    } catch {
      throw new UnauthorizedError("Invalid or expired authentication token");
    }
  }

  /**
   * Generates a secure random token and its SHA-256 hash.
   */
  private generateRandomToken(): { rawToken: string; tokenHash: string } {
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = this.hashToken(rawToken);
    return { rawToken, tokenHash };
  }

  /**
   * Hashes a token using SHA-256 for secure storage and comparison.
   */
  hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  /**
   * Sanitizes a user model for client responses.
   */
  sanitizeUser(user: User): UserResponse {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      status: user.status,
      createdAt: user.createdAt.toISOString(),
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() || null,
      lastLoginAt: user.lastLoginAt?.toISOString() || null,
    };
  }

  /**
   * Register a new user account.
   */
  async register(input: RegisterInput): Promise<AuthSessionResponse> {
    const normalizedEmail = input.email.trim().toLowerCase();

    // Check uniqueness
    const existing = await this.repo.findByEmail(normalizedEmail);
    if (existing) {
      throw new ConflictError("An account with this email address already exists");
    }

    // Securely hash password
    const passwordHash = await this.hashPassword(input.password);

    // Create user
    const user = await this.repo.createUser({
      email: normalizedEmail,
      passwordHash,
      displayName: input.displayName,
    });

    logger.info({ userId: user.id }, "New user registered successfully");

    // Generate tokens
    const accessToken = this.generateAccessToken(user);
    const { rawToken: refreshToken, tokenHash } = this.generateRandomToken();
    const familyId = uuidv4();
    const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    await this.repo.createRefreshToken({
      userId: user.id,
      tokenHash,
      familyId,
      expiresAt: refreshExpiresAt,
    });

    return {
      token: accessToken,
      accessToken,
      refreshToken,
      user: this.sanitizeUser(user),
    };
  }

  /**
   * Authenticate a user and issue sessions.
   */
  async login(input: LoginInput): Promise<AuthSessionResponse> {
    const normalizedEmail = input.email.trim().toLowerCase();

    const user = await this.repo.findByEmail(normalizedEmail);
    // Generic error avoids account enumeration
    if (!user) {
      throw new UnauthorizedError("Invalid email or password");
    }

    const isValidPassword = await this.verifyPassword(input.password, user.passwordHash);
    if (!isValidPassword) {
      throw new UnauthorizedError("Invalid email or password");
    }

    // Account status check
    if (user.status === UserStatus.DISABLED || user.status === UserStatus.DELETION_PENDING) {
      throw new ForbiddenError(
        "Your account is inactive or scheduled for deletion. Please contact support."
      );
    }

    await this.repo.updateLastLogin(user.id);

    // Generate tokens
    const accessToken = this.generateAccessToken(user);
    const { rawToken: refreshToken, tokenHash } = this.generateRandomToken();
    const familyId = uuidv4();
    const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    await this.repo.createRefreshToken({
      userId: user.id,
      tokenHash,
      familyId,
      expiresAt: refreshExpiresAt,
    });

    logger.info({ userId: user.id }, "User logged in successfully");

    return {
      token: accessToken,
      accessToken,
      refreshToken,
      user: this.sanitizeUser(user),
    };
  }

  /**
   * Refresh session tokens with rotation and reuse detection.
   */
  async refreshSession(refreshToken: string): Promise<{
    token: string;
    accessToken: string;
    refreshToken: string;
  }> {
    const tokenHash = this.hashToken(refreshToken);
    const tokenRecord = await this.repo.findRefreshToken(tokenHash);

    if (!tokenRecord) {
      throw new UnauthorizedError("Invalid refresh token");
    }

    // Check if token was already revoked -> REUSE ATTACK DETECTED
    if (tokenRecord.revokedAt !== null) {
      logger.warn(
        { userId: tokenRecord.userId, familyId: tokenRecord.familyId },
        "Refresh token reuse detected! Invalidating entire token family."
      );
      await this.repo.revokeFamily(tokenRecord.familyId);
      throw new UnauthorizedError("Token reuse detected. Session terminated for security.");
    }

    // Check expiry
    if (new Date() > tokenRecord.expiresAt) {
      throw new UnauthorizedError("Refresh token has expired. Please sign in again.");
    }

    // Check user status
    if (
      tokenRecord.user.status === UserStatus.DISABLED ||
      tokenRecord.user.status === UserStatus.DELETION_PENDING
    ) {
      throw new ForbiddenError("Account is inactive or pending deletion");
    }

    // Invalidate the current used refresh token
    await this.repo.revokeRefreshToken(tokenRecord.id);

    // Rotate: Issue a new refresh token within the same family
    const { rawToken: newRefreshToken, tokenHash: newTokenHash } = this.generateRandomToken();
    const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    await this.repo.createRefreshToken({
      userId: tokenRecord.userId,
      tokenHash: newTokenHash,
      familyId: tokenRecord.familyId,
      expiresAt: refreshExpiresAt,
    });

    const newAccessToken = this.generateAccessToken(tokenRecord.user);

    return {
      token: newAccessToken,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    };
  }

  /**
   * Request password reset instructions (generic response avoids email enumeration).
   */
  async forgotPassword(input: ForgotPasswordInput): Promise<{
    message: string;
    resetToken?: string;
  }> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const genericSuccess = {
      message: "If an account with that email exists, password reset instructions have been sent.",
    };

    const user = await this.repo.findByEmail(normalizedEmail);
    if (!user || user.status !== UserStatus.ACTIVE) {
      return genericSuccess;
    }

    // Invalidate existing reset tokens
    await this.repo.revokeExistingResetTokens(user.id);

    // Generate single-use reset token
    const { rawToken, tokenHash } = this.generateRandomToken();
    const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

    await this.repo.createPasswordResetToken({
      userId: user.id,
      tokenHash,
      expiresAt,
    });

    logger.info({ userId: user.id }, "Password reset token generated");

    // In test or development environments, return the token for automated testing
    const isTestOrDev = process.env["NODE_ENV"] === "test" || process.env["NODE_ENV"] === "development";
    return {
      ...genericSuccess,
      ...(isTestOrDev ? { resetToken: rawToken } : {}),
    };
  }

  /**
   * Reset password using a valid single-use token.
   */
  async resetPassword(input: ResetPasswordInput): Promise<{ message: string }> {
    const tokenHash = this.hashToken(input.token);
    const tokenRecord = await this.repo.findValidPasswordResetToken(tokenHash);

    if (!tokenRecord) {
      throw new BadRequestError("Invalid or expired password reset token");
    }

    // Hash new password
    const newPasswordHash = await this.hashPassword(input.password);

    // Update password, mark token used, and revoke all sessions for security
    await this.repo.updatePassword(tokenRecord.userId, newPasswordHash);
    await this.repo.markPasswordResetTokenUsed(tokenRecord.id);
    await this.repo.revokeAllUserRefreshTokens(tokenRecord.userId);

    logger.info({ userId: tokenRecord.userId }, "Password reset successfully completed");

    return {
      message: "Your password has been successfully reset. Please sign in with your new password.",
    };
  }

  /**
   * Logout user by revoking the provided refresh token.
   */
  async logout(refreshToken?: string): Promise<{ message: string }> {
    if (refreshToken) {
      const tokenHash = this.hashToken(refreshToken);
      const tokenRecord = await this.repo.findRefreshToken(tokenHash);
      if (tokenRecord) {
        await this.repo.revokeRefreshToken(tokenRecord.id);
      }
    }
    return { message: "Logged out successfully" };
  }

  /**
   * Get current authenticated user details.
   */
  async getMe(userId: string): Promise<UserResponse> {
    const user = await this.repo.findById(userId);
    if (!user) {
      throw new UnauthorizedError("User account no longer exists");
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenError("Account is inactive or pending deletion");
    }
    return this.sanitizeUser(user);
  }

  /**
   * Update profile information for the authenticated user.
   */
  async updateProfile(userId: string, input: UpdateProfileInput): Promise<UserResponse> {
    const user = await this.repo.findById(userId);
    if (!user) {
      throw new UnauthorizedError("User account no longer exists");
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenError("Account is inactive or pending deletion");
    }

    const updated = await this.repo.updateProfile(userId, { displayName: input.displayName });
    logger.info({ userId }, "User profile updated successfully");
    return this.sanitizeUser(updated);
  }

  /**
   * Complete account deletion workflow:
   * 1. Re-authenticates if a confirmation password is provided.
   * 2. Immediately revokes access by updating user status to DELETION_PENDING and revoking all refresh tokens.
   * 3. Deletes private files from storage (documents/${userId}/*).
   * 4. Purges all personal and generated data (conversations, messages, quizzes, study plans, documents, document chunks, feedbacks, tokens).
   * 5. If hardDelete is explicitly requested, purges the user row; otherwise maintains tombstone in DELETION_PENDING status.
   * 6. Emits operational log and safely tolerates partial failure for idempotent retries.
   */
  async deleteAccount(
    userId: string,
    options?: { password?: string; confirmation?: string; hardDelete?: boolean }
  ): Promise<{ deleted: boolean; message: string }> {
    const user = await this.repo.findById(userId);
    if (!user) {
      // Idempotent: already deleted
      return { deleted: true, message: "Account scheduled for deletion and all personal data purged." };
    }

    // Optional re-authentication if password was submitted
    if (options?.password) {
      const isValid = await this.verifyPassword(options.password, user.passwordHash);
      if (!isValid) {
        throw new UnauthorizedError("Incorrect password provided for account deletion.");
      }
    }

    // Step 1: Immediately prevent access to all resources
    await this.repo.updateUserStatus(userId, UserStatus.DELETION_PENDING, new Date());
    await this.repo.revokeAllUserRefreshTokens(userId);

    try {
      // Step 2: Delete private storage files
      await fileStorageService.deleteUserStorage(userId);

      // Step 3: Purge user-owned data
      if (options?.hardDelete) {
        await this.repo.deleteUserCascade(userId);
      } else {
        await this.repo.purgeUserData(userId);
      }

      logger.info({ userId }, "User account and all personal data successfully purged/scheduled for deletion");
      return {
        deleted: true,
        message: "Account scheduled for deletion and all personal data purged.",
      };
    } catch (error: unknown) {
      const err = error instanceof Error ? error.message : String(error);
      logger.error({ userId, error: err }, "Error during account deletion execution pipeline");
      throw error;
    }
  }
}

export const authService = new AuthService();
