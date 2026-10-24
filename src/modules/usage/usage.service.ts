import { v4 as uuidv4 } from "uuid";
import { usageRepository, UsageRepository, RecordAIUsageData } from "./usage.repository";
import { getEnv } from "../../config/env";
import { NotFoundError, ForbiddenError, RateLimitError } from "../../utils/errors";
import { UsageSummaryResponse, FeedbackResponse } from "../../types/usage";
import { SubmitFeedbackInput } from "./usage.validators";
import { AIUsage } from "../../generated/prisma/client";

export class UsageService {
  constructor(private readonly repo: UsageRepository = usageRepository) {}

  /**
   * Derives actual AI usage metrics, quotas, and cost accounting for the authenticated user.
   * Does NOT invent token counts or cost values.
   */
  async getUsage(userId: string): Promise<UsageSummaryResponse> {
    const env = getEnv();
    const records = await this.repo.getUserUsageRecords(userId);

    let totalTokens = 0;
    let totalCost = 0;
    const featureBreakdown: Record<string, number> = {
      TUTOR_CHAT: 0,
      DOCUMENT_QA: 0,
      QUIZ_GENERATION: 0,
      STUDY_PLAN_GENERATION: 0,
    };

    for (const record of records) {
      if (record.inputTokens != null) totalTokens += record.inputTokens;
      if (record.outputTokens != null) totalTokens += record.outputTokens;
      if (record.estimatedCost != null) totalCost += Number(record.estimatedCost);

      const feat = record.feature;
      featureBreakdown[feat] = (featureBreakdown[feat] ?? 0) + 1;
    }

    const todayCount = await this.repo.getTodayRequestCount(userId);
    const quotaLimit = env.AI_DAILY_QUOTA_LIMIT;
    const requestsRemaining = Math.max(0, quotaLimit - todayCount);
    const isExhausted = requestsRemaining <= 0;

    // Reset time is midnight UTC next day
    const resetTime = new Date();
    resetTime.setUTCHours(24, 0, 0, 0);

    const quotaMessage = isExhausted
      ? "Daily AI usage quota reached. Resets at midnight UTC."
      : `You have used ${todayCount} of ${quotaLimit} daily requests.`;

    return {
      totalTokens,
      requestCount: records.length,
      estimatedCost: Number(totalCost.toFixed(6)),
      featureBreakdown,
      quotaLimit,
      requestsRemaining,
      isExhausted,
      quotaMessage,
      resetTime: resetTime.toISOString(),
    };
  }

  /**
   * Enforces server-side quota and global cost check with row-locking to ensure safety under concurrency.
   */
  async checkQuota(userId: string): Promise<void> {
    const env = getEnv();
    const { todayCount, monthCost } = await this.repo.checkAndLockUserQuota(userId);

    if (todayCount >= env.AI_DAILY_QUOTA_LIMIT) {
      throw new RateLimitError(
        "Daily AI request limit reached. Your quota will reset at midnight UTC."
      );
    }

    if (monthCost >= env.AI_GLOBAL_MONTHLY_COST_LIMIT_USD) {
      throw new RateLimitError(
        "Global monthly AI budget reached. AI requests are temporarily paused."
      );
    }
  }

  /**
   * Submits user feedback for an AI response with message ownership validation.
   */
  async submitFeedback(userId: string, input: SubmitFeedbackInput): Promise<FeedbackResponse> {
    // If messageId is provided, verify message exists and belongs to the authenticated user
    if (input.messageId) {
      const msg = await this.repo.findMessageWithConversation(input.messageId);
      if (!msg) {
        throw new NotFoundError("Associated message was not found.");
      }
      if (msg.conversation.userId !== userId) {
        throw new ForbiddenError("You cannot submit feedback for another user's message.");
      }
    }

    const feedback = await this.repo.createFeedback({
      id: uuidv4(),
      userId,
      messageId: input.messageId || null,
      rating: input.rating,
      category: input.category || null,
      comment: input.comment,
    });

    return {
      id: feedback.id,
      userId: feedback.userId,
      rating: feedback.rating,
      category: feedback.category,
      comment: feedback.comment,
      messageId: feedback.messageId,
      createdAt: feedback.createdAt.toISOString(),
    };
  }

  /**
   * Records AI Usage telemetry with actual calculated cost.
   */
  async recordUsage(data: RecordAIUsageData): Promise<AIUsage> {
    return this.repo.recordAIUsage(data);
  }
}

export const usageService = new UsageService();
