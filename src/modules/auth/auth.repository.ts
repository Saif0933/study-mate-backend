import { prisma } from "../../config/prisma";
import { User, PasswordResetToken, RefreshToken } from "../../generated/prisma/client";
import { UserStatus } from "../../generated/prisma/enums";

export class AuthRepository {
  /**
   * Find a user by normalized email address.
   */
  async findByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({
      where: { email },
    });
  }

  /**
   * Find a user by ID.
   */
  async findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({
      where: { id },
    });
  }

  /**
   * Create a new registered user.
   */
  async createUser(data: {
    email: string;
    passwordHash: string;
    displayName?: string;
  }): Promise<User> {
    return prisma.user.create({
      data: {
        email: data.email,
        passwordHash: data.passwordHash,
        displayName: data.displayName,
        status: UserStatus.ACTIVE,
      },
    });
  }

  /**
   * Update the user's password hash.
   */
  async updatePassword(userId: string, passwordHash: string): Promise<User> {
    return prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }

  /**
   * Update last login timestamp.
   */
  async updateLastLogin(userId: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });
  }

  /**
   * Soft-delete or update user account status.
   */
  async updateUserStatus(
    userId: string,
    status: UserStatus,
    deletedAt?: Date | null
  ): Promise<User> {
    return prisma.user.update({
      where: { id: userId },
      data: {
        status,
        ...(deletedAt !== undefined ? { deletedAt } : {}),
      },
    });
  }

  // --- Password Reset Tokens ---

  /**
   * Invalidate prior unused password reset tokens for a user.
   */
  async revokeExistingResetTokens(userId: string): Promise<void> {
    await prisma.passwordResetToken.deleteMany({
      where: { userId, usedAt: null },
    });
  }

  /**
   * Store a single-use password reset token hash.
   */
  async createPasswordResetToken(data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<PasswordResetToken> {
    return prisma.passwordResetToken.create({
      data: {
        userId: data.userId,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
      },
    });
  }

  /**
   * Find a valid, unused password reset token by token hash.
   */
  async findValidPasswordResetToken(
    tokenHash: string
  ): Promise<(PasswordResetToken & { user: User }) | null> {
    return prisma.passwordResetToken.findFirst({
      where: {
        tokenHash,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });
  }

  /**
   * Mark a password reset token as used.
   */
  async markPasswordResetTokenUsed(tokenId: string): Promise<void> {
    await prisma.passwordResetToken.update({
      where: { id: tokenId },
      data: { usedAt: new Date() },
    });
  }

  // --- Refresh Tokens ---

  /**
   * Store a hashed refresh token with family tracking.
   */
  async createRefreshToken(data: {
    userId: string;
    tokenHash: string;
    familyId: string;
    expiresAt: Date;
  }): Promise<RefreshToken> {
    return prisma.refreshToken.create({
      data: {
        userId: data.userId,
        tokenHash: data.tokenHash,
        familyId: data.familyId,
        expiresAt: data.expiresAt,
      },
    });
  }

  /**
   * Look up a refresh token by hash.
   */
  async findRefreshToken(
    tokenHash: string
  ): Promise<(RefreshToken & { user: User }) | null> {
    return prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
  }

  /**
   * Revoke a single refresh token.
   */
  async revokeRefreshToken(id: string): Promise<void> {
    await prisma.refreshToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Revoke all tokens in a family (used when reuse is detected).
   */
  async revokeFamily(familyId: string): Promise<void> {
    await prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Revoke all refresh tokens for a user (used on password change or logout all).
   */
  async revokeAllUserRefreshTokens(userId: string): Promise<void> {
    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Update user profile information.
   */
  async updateProfile(userId: string, data: { displayName?: string }): Promise<User> {
    return prisma.user.update({
      where: { id: userId },
      data: {
        displayName: data.displayName,
      },
    });
  }

  /**
   * Cascading hard-deletion of user account and all personal data.
   * Tolerates already-deleted user to ensure idempotency.
   */
  async deleteUserCascade(userId: string): Promise<void> {
    try {
      await prisma.user.delete({
        where: { id: userId },
      });
    } catch (error: unknown) {
      const prismaError = error as { code?: string };
      if (prismaError.code === "P2025") {
        // Record does not exist / was already deleted
        return;
      }
      throw error;
    }
  }

  /**
   * Purges all personal and generated data associated with a user while leaving the user record in DELETION_PENDING.
   */
  async purgeUserData(userId: string): Promise<void> {
    await prisma.$transaction([
      prisma.conversation.deleteMany({ where: { userId } }),
      prisma.document.deleteMany({ where: { userId } }),
      prisma.quiz.deleteMany({ where: { userId } }),
      prisma.studyPlan.deleteMany({ where: { userId } }),
      prisma.feedback.deleteMany({ where: { userId } }),
      prisma.refreshToken.deleteMany({ where: { userId } }),
      prisma.passwordResetToken.deleteMany({ where: { userId } }),
    ]);
  }
}

export const authRepository = new AuthRepository();
