import { prisma } from "../../config/prisma";
import { Conversation, Message, AIUsage } from "../../generated/prisma/client";
import { MessageRole, AIRequestFeature, AIRequestStatus } from "../../generated/prisma/enums";
import { calculateEstimatedCost } from "../../utils/cost-calculator";

export class ConversationRepository {
  /**
   * Create a new conversation for a user.
   */
  async createConversation(data: {
    userId: string;
    title?: string;
  }): Promise<Conversation> {
    return prisma.conversation.create({
      data: {
        userId: data.userId,
        title: data.title || "New conversation",
      },
    });
  }

  /**
   * Find a conversation by ID (ignoring soft-deleted records).
   */
  async findById(id: string): Promise<Conversation | null> {
    return prisma.conversation.findFirst({
      where: {
        id,
        deletedAt: null,
      },
    });
  }

  /**
   * List non-deleted conversations for a specific user.
   */
  async findByUserId(
    userId: string,
    limit = 50,
    offset = 0
  ): Promise<Conversation[]> {
    return prisma.conversation.findMany({
      where: {
        userId,
        deletedAt: null,
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
      skip: offset,
    });
  }

  /**
   * Update conversation title and timestamp.
   */
  async updateTitle(id: string, title: string): Promise<Conversation> {
    return prisma.conversation.update({
      where: { id },
      data: {
        title,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Soft-delete a conversation.
   */
  async softDelete(id: string): Promise<void> {
    await prisma.conversation.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Get all messages for a conversation ordered chronologically.
   */
  async getMessages(conversationId: string): Promise<Message[]> {
    return prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * Save a single message.
   */
  async createMessage(data: {
    conversationId: string;
    role: MessageRole;
    content: string;
    modelId?: string;
    inputTokens?: number;
    outputTokens?: number;
    latencyMs?: number;
  }): Promise<Message> {
    return prisma.message.create({
      data: {
        conversationId: data.conversationId,
        role: data.role,
        content: data.content,
        modelId: data.modelId,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        latencyMs: data.latencyMs,
      },
    });
  }

  /**
   * Touch conversation's updatedAt timestamp.
   */
  async touchUpdatedAt(id: string): Promise<void> {
    await prisma.conversation.update({
      where: { id },
      data: { updatedAt: new Date() },
    });
  }

  /**
   * Record AI usage for telemetry and quota tracking.
   */
  async recordAIUsage(data: {
    userId: string;
    requestId: string;
    feature: AIRequestFeature;
    provider?: string;
    modelId: string;
    status: AIRequestStatus;
    inputTokens?: number;
    outputTokens?: number;
    latencyMs?: number;
    errorCode?: string;
  }): Promise<AIUsage> {
    return prisma.aIUsage.create({
      data: {
        userId: data.userId,
        requestId: data.requestId,
        feature: data.feature,
        provider: data.provider || "openai",
        modelId: data.modelId,
        status: data.status,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        latencyMs: data.latencyMs,
        estimatedCost: calculateEstimatedCost(data.modelId, data.inputTokens, data.outputTokens),
        errorCode: data.errorCode,
      },
    });
  }
}

export const conversationRepository = new ConversationRepository();
