import { conversationRepository, ConversationRepository } from "./conversation.repository";
import {
  CreateConversationInput,
  SendMessageInput,
  RenameConversationInput,
} from "./conversation.validators";
import { ConversationResponse, MessageResponse } from "../../types/conversation";
import { MessageRole, AIRequestFeature, AIRequestStatus } from "../../generated/prisma/enums";
import { NotFoundError, RateLimitError } from "../../utils/errors";
import { tutorGraph } from "../../ai/graphs/tutor.graph";
import { Conversation, Message } from "../../generated/prisma/client";
import { logger } from "../../utils/logger";
import { usageService } from "../usage/usage.service";

export class ConversationService {
  constructor(private readonly repo: ConversationRepository = conversationRepository) {}

  /**
   * Sanitizes a Conversation model into client response format.
   */
  sanitizeConversation(conv: Conversation): ConversationResponse {
    return {
      id: conv.id,
      title: conv.title,
      createdAt: conv.createdAt.toISOString(),
      updatedAt: conv.updatedAt?.toISOString() || null,
    };
  }

  /**
   * Sanitizes a Message model into client response format with lowercase role.
   */
  sanitizeMessage(msg: Message): MessageResponse {
    let content = msg.content;
    let imageBase64: string | undefined = undefined;

    const imgMatch = content.match(/^\[IMAGE_ATTACHED:([^\]]+)\]\n?([\s\S]*)$/);
    if (imgMatch) {
      imageBase64 = imgMatch[1];
      content = imgMatch[2];
    }

    return {
      id: msg.id,
      conversationId: msg.conversationId,
      role: msg.role.toLowerCase(),
      content,
      imageBase64,
      createdAt: msg.createdAt.toISOString(),
      modelId: msg.modelId,
      inputTokens: msg.inputTokens,
      outputTokens: msg.outputTokens,
      latencyMs: msg.latencyMs,
    };
  }

  /**
   * Create a new conversation for authenticated user.
   */
  async createConversation(
    userId: string,
    input: CreateConversationInput
  ): Promise<ConversationResponse> {
    const conv = await this.repo.createConversation({
      userId,
      title: input.title,
    });
    return this.sanitizeConversation(conv);
  }

  /**
   * List non-deleted conversations for authenticated user.
   */
  async getConversations(userId: string): Promise<ConversationResponse[]> {
    const conversations = await this.repo.findByUserId(userId);
    return conversations.map((c) => this.sanitizeConversation(c));
  }

  /**
   * Get a specific conversation by ID, validating user ownership.
   */
  async getConversation(userId: string, conversationId: string): Promise<ConversationResponse> {
    const conv = await this.repo.findById(conversationId);
    if (!conv || conv.userId !== userId || conv.deletedAt) {
      throw new NotFoundError("Conversation not found");
    }
    return this.sanitizeConversation(conv);
  }

  /**
   * Get all messages for a specific conversation, strictly validating user ownership.
   */
  async getMessages(
    userId: string,
    conversationId: string
  ): Promise<MessageResponse[]> {
    const conversation = await this.repo.findById(conversationId);
    if (!conversation || conversation.userId !== userId) {
      throw new NotFoundError("Conversation not found");
    }

    const messages = await this.repo.getMessages(conversationId);
    return messages.map((m) => this.sanitizeMessage(m));
  }

  /**
   * Send a message to AI Tutor, invoke LangGraph workflow, persist conversation, and record usage.
   */
  async sendMessage(
    userId: string,
    conversationId: string,
    input: SendMessageInput,
    requestId: string
  ): Promise<MessageResponse> {
    const conversation = await this.repo.findById(conversationId);
    if (!conversation || conversation.userId !== userId) {
      throw new NotFoundError("Conversation not found");
    }

    // Duplicate submission guard (checks user's last message within 3 seconds)
    const existingMessages = await this.repo.getMessages(conversationId);
    const lastUserMsg = existingMessages.slice().reverse().find((m) => m.role === MessageRole.USER);
    if (
      lastUserMsg &&
      lastUserMsg.content === input.content &&
      Date.now() - lastUserMsg.createdAt.getTime() < 3000
    ) {
      throw new RateLimitError("Duplicate message detected. Please wait a moment before resending.");
    }

    // 0. Enforce AI usage quota before invocation
    await usageService.checkQuota(userId);

    // 1. Persist User Message (with image annotation if imageBase64 is provided)
    const contentToPersist = input.imageBase64
      ? `[IMAGE_ATTACHED:${input.imageBase64}]\n${input.content || ""}`.trim()
      : input.content;

    await this.repo.createMessage({
      conversationId,
      role: MessageRole.USER,
      content: contentToPersist,
    });

    // 2. Prepare Conversation History for LangGraph context
    const history = existingMessages.map((m) => {
      let text = m.content;
      const match = text.match(/^\[IMAGE_ATTACHED:[^\]]+\]\n?([\s\S]*)$/);
      if (match) {
        text = match[1] || "[User attached an image]";
      }
      return {
        role: m.role.toLowerCase(),
        content: text,
      };
    });

    // 3. Invoke LangGraph AI Tutor workflow
    try {
      const promptText =
        input.content && input.content.trim().length > 0
          ? input.content.trim()
          : "Please carefully analyze the provided image, explain the concepts shown, and solve or answer any problems/questions step-by-step.";

      const result = await tutorGraph.invoke({
        userId,
        conversationId,
        userMessage: promptText,
        imageBase64: input.imageBase64,
        explanationMode: input.explanationMode,
        history,
      });

      // 4. Persist Assistant Response only after successful generation
      const assistantMessage = await this.repo.createMessage({
        conversationId,
        role: MessageRole.ASSISTANT,
        content: result.responseContent,
        modelId: result.modelId,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: result.latencyMs,
      });

      // 5. Update conversation timestamp & auto-generate title if default
      if (conversation.title === "New conversation" && existingMessages.length === 0) {
        const words = input.content.split(/\s+/).slice(0, 6).join(" ");
        const autoTitle = words.length > 40 ? `${words.substring(0, 37)}...` : words;
        await this.repo.updateTitle(conversationId, autoTitle);
      } else {
        await this.repo.touchUpdatedAt(conversationId);
      }

      // 6. Record Telemetry & AIUsage
      await this.repo.recordAIUsage({
        userId,
        requestId,
        feature: AIRequestFeature.TUTOR_CHAT,
        modelId: result.modelId,
        status: AIRequestStatus.SUCCESS,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: result.latencyMs,
      });

      logger.info(
        { userId, conversationId, latencyMs: result.latencyMs },
        "AI tutor response successfully generated and persisted"
      );

      return this.sanitizeMessage(assistantMessage);
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      const isRateLimited = errMessage.includes("rate limit") || errMessage.includes("429");

      // Record Failed AIUsage without storing secrets
      await this.repo.recordAIUsage({
        userId,
        requestId,
        feature: AIRequestFeature.TUTOR_CHAT,
        modelId: "gpt-4o",
        status: isRateLimited ? AIRequestStatus.RATE_LIMITED : AIRequestStatus.FAILED,
        errorCode: isRateLimited ? "RATE_LIMITED" : "GENERATION_FAILED",
      });

      throw error;
    }
  }

  /**
   * Rename a conversation title, enforcing user ownership.
   */
  async renameConversation(
    userId: string,
    conversationId: string,
    input: RenameConversationInput
  ): Promise<ConversationResponse> {
    const conversation = await this.repo.findById(conversationId);
    if (!conversation || conversation.userId !== userId) {
      throw new NotFoundError("Conversation not found");
    }

    const updated = await this.repo.updateTitle(conversationId, input.title);
    return this.sanitizeConversation(updated);
  }

  /**
   * Soft-delete a conversation, enforcing user ownership.
   */
  async deleteConversation(
    userId: string,
    conversationId: string
  ): Promise<{ deleted: boolean; message: string }> {
    const conversation = await this.repo.findById(conversationId);
    if (!conversation || conversation.userId !== userId) {
      throw new NotFoundError("Conversation not found");
    }

    await this.repo.softDelete(conversationId);
    return {
      deleted: true,
      message: "Conversation deleted successfully",
    };
  }
}

export const conversationService = new ConversationService();
