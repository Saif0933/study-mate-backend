import { prisma } from "../../config/prisma";
import { AIUsage, Feedback, Message } from "../../generated/prisma/client";
import { AIRequestFeature, AIRequestStatus } from "../../generated/prisma/enums";
import { calculateEstimatedCost } from "../../utils/cost-calculator";

export interface CreateFeedbackData {
  id?: string;
  userId: string;
  messageId?: string | null;
  rating: string;
  category?: string | null;
  comment: string;
}

export interface RecordAIUsageData {
  userId: string;
  requestId: string;
  feature: AIRequestFeature;
  provider?: string;
  modelId: string;
  status: AIRequestStatus;
  inputTokens?: number | null;
  outputTokens?: number | null;
  latencyMs?: number | null;
  estimatedCost?: number | null;
  errorCode?: string | null;
}

export class UsageRepository {
  /**
   * Retrieves all recorded AI usage records for a user.
   */
  async getUserUsageRecords(userId: string): Promise<AIUsage[]> {
    return prisma.aIUsage.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Retrieves count of AI requests made today (since midnight UTC).
   */
  async getTodayRequestCount(userId: string): Promise<number> {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    return prisma.aIUsage.count({
      where: {
        userId,
        createdAt: { gte: today },
      },
    });
  }

  /**
   * Concurrency-safe quota and cost inspection.
   * Acquires a row-level lock on the User record to serialize concurrent quota checks.
   */
  async checkAndLockUserQuota(userId: string): Promise<{ todayCount: number; monthCost: number }> {
    return prisma.$transaction(async (tx) => {
      // Row lock to serialize concurrent quota decisions for this user
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;

      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      const firstOfMonth = new Date();
      firstOfMonth.setUTCDate(1);
      firstOfMonth.setUTCHours(0, 0, 0, 0);

      const todayCount = await tx.aIUsage.count({
        where: {
          userId,
          createdAt: { gte: today },
        },
      });

      const monthUsages = await tx.aIUsage.findMany({
        where: {
          createdAt: { gte: firstOfMonth },
          estimatedCost: { not: null },
        },
        select: { estimatedCost: true },
      });

      const monthCost = monthUsages.reduce(
        (sum, u) => sum + (u.estimatedCost ? Number(u.estimatedCost) : 0),
        0
      );

      return { todayCount, monthCost };
    });
  }

  /**
   * Records AI Usage entry with telemetry and actual cost accounting.
   * Does NOT invent token counts or costs when data is absent.
   */
  async recordAIUsage(data: RecordAIUsageData): Promise<AIUsage> {
    const estimatedCost =
      data.estimatedCost !== undefined
        ? data.estimatedCost
        : calculateEstimatedCost(data.modelId, data.inputTokens, data.outputTokens);

    return prisma.aIUsage.create({
      data: {
        userId: data.userId,
        requestId: data.requestId,
        feature: data.feature,
        provider: data.provider || "openai",
        modelId: data.modelId,
        status: data.status,
        inputTokens: data.inputTokens ?? null,
        outputTokens: data.outputTokens ?? null,
        latencyMs: data.latencyMs ?? null,
        estimatedCost: estimatedCost != null ? estimatedCost : null,
        errorCode: data.errorCode ?? null,
      },
    });
  }

  /**
   * Saves feedback record to database.
   */
  async createFeedback(data: CreateFeedbackData): Promise<Feedback> {
    return prisma.feedback.create({
      data: {
        id: data.id,
        userId: data.userId,
        messageId: data.messageId || null,
        rating: data.rating,
        category: data.category || null,
        comment: data.comment,
      },
    });
  }

  /**
   * Finds message including conversation for authorization check.
   */
  async findMessageWithConversation(messageId: string): Promise<(Message & { conversation: { userId: string } }) | null> {
    return prisma.message.findUnique({
      where: { id: messageId },
      include: {
        conversation: {
          select: { userId: true },
        },
      },
    });
  }
}

export const usageRepository = new UsageRepository();
