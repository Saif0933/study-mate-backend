import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import { BaseMessage, HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import { createChatModel, shouldUseLiveAi } from "../model-factory";
import { getTutorPromptForMode } from "../prompts/tutor.prompts";
import { getEnv } from "../../config/env";
import { logger } from "../../utils/logger";
import { AppError } from "../../utils/errors";

export interface ChatHistoryMessage {
  role: string;
  content: string;
}

export const TutorStateAnnotation = Annotation.Root({
  userId: Annotation<string>(),
  conversationId: Annotation<string>(),
  userMessage: Annotation<string>(),
  imageBase64: Annotation<string | undefined>({
    reducer: (_, next) => next,
  }),
  explanationMode: Annotation<string | undefined>(),
  history: Annotation<ChatHistoryMessage[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),
  boundedMessages: Annotation<BaseMessage[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),
  responseContent: Annotation<string>({
    reducer: (_, next) => next,
    default: () => "",
  }),
  modelId: Annotation<string>({
    reducer: (_, next) => next,
    default: () => "gpt-4o",
  }),
  inputTokens: Annotation<number>({
    reducer: (_, next) => next,
    default: () => 0,
  }),
  outputTokens: Annotation<number>({
    reducer: (_, next) => next,
    default: () => 0,
  }),
  latencyMs: Annotation<number>({
    reducer: (_, next) => next,
    default: () => 0,
  }),
  error: Annotation<string | undefined>({
    reducer: (_, next) => next,
  }),
});

export type TutorStateType = typeof TutorStateAnnotation.State;

/**
 * Node 1: Prepares context and applies token budget / message window policy.
 */
export async function prepareContextNode(state: TutorStateType): Promise<Partial<TutorStateType>> {
  const env = getEnv();
  const systemPrompt = getTutorPromptForMode(state.explanationMode);
  const messages: BaseMessage[] = [new SystemMessage(systemPrompt)];

  // Bounded conversation history policy (last N messages)
  const maxHistory = env.AI_CONTEXT_MAX_MESSAGES || 10;
  const recentHistory = (state.history || []).slice(-maxHistory);

  for (const item of recentHistory) {
    if (item.role.toLowerCase() === "assistant") {
      messages.push(new AIMessage(item.content));
    } else {
      messages.push(new HumanMessage(item.content));
    }
  }

  // Add the current user message (multimodal if image is attached)
  if (state.imageBase64 && state.imageBase64.trim().length > 0) {
    let cleanBase64 = state.imageBase64.trim();
    if (!cleanBase64.startsWith("data:")) {
      cleanBase64 = `data:image/jpeg;base64,${cleanBase64}`;
    }

    const promptText =
      state.userMessage && state.userMessage.trim().length > 0
        ? state.userMessage.trim()
        : "Please carefully analyze the provided image, explain the concepts shown, and solve or answer any problems/questions step-by-step.";

    messages.push(
      new HumanMessage({
        content: [
          {
            type: "text",
            text: promptText,
          },
          {
            type: "image_url",
            image_url: {
              url: cleanBase64,
            },
          },
        ],
      })
    );
  } else {
    messages.push(new HumanMessage(state.userMessage));
  }

  return {
    boundedMessages: messages,
    modelId: env.OPENAI_MODEL,
  };
}

/**
 * Node 2: Generates tutor response via OpenAI GPT model.
 */
export async function generateTutorResponseNode(state: TutorStateType): Promise<Partial<TutorStateType>> {
  const env = getEnv();
  const startTime = Date.now();

  if (!shouldUseLiveAi()) {
    if (env.NODE_ENV === "production") {
      throw new AppError("OPENAI_API_KEY or GEMINI_API_KEY is required for production AI Tutor operation", 500, "CONFIG_ERROR");
    }

    // Deterministic educational fallback for test/offline environments
    const mockContent = state.imageBase64
      ? `[AI Tutor Image Analysis - ${state.explanationMode || "standard"} mode]: I have analyzed the uploaded image. Here is the breakdown of "${state.userMessage || "the content in this image"}". Understanding core visual principles step-by-step is key!`
      : `[AI Tutor - ${state.explanationMode || "standard"} mode]: Here is a structured explanation of "${state.userMessage}". Understanding core principles step-by-step is key!`;
    const latency = Date.now() - startTime;
    return {
      responseContent: mockContent,
      inputTokens: Math.max(15, Math.ceil(state.userMessage.length / 4)),
      outputTokens: Math.max(25, Math.ceil(mockContent.length / 4)),
      latencyMs: Math.max(1, latency),
    };
  }

  try {
    const model = createChatModel();

    const response = await model.invoke(state.boundedMessages);
    const latencyMs = Date.now() - startTime;

    const content = typeof response.content === "string" ? response.content : JSON.stringify(response.content);

    // Extract token usage metadata if provided by OpenAI
    const usage = response.usage_metadata;
    const inputTokens = usage?.input_tokens ?? Math.ceil(state.userMessage.length / 4);
    const outputTokens = usage?.output_tokens ?? Math.ceil(content.length / 4);

    return {
      responseContent: content,
      inputTokens,
      outputTokens,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errMessage = error instanceof Error ? error.message : String(error);
    logger.error({ err: errMessage, latencyMs }, "OpenAI tutor invocation error");

    if (errMessage.includes("timeout") || errMessage.includes("ETIMEDOUT")) {
      throw new AppError("AI tutor request timed out. Please try again.", 504, "PROVIDER_TIMEOUT");
    }
    if (errMessage.includes("429") || errMessage.includes("quota")) {
      throw new AppError("AI provider rate limit or quota exceeded. Please try again shortly.", 429, "PROVIDER_RATE_LIMIT");
    }

    throw new AppError("AI provider error occurred while generating explanation", 502, "PROVIDER_ERROR");
  }
}

/**
 * Node 3: Validates model-generated output.
 */
export async function validateOutputNode(state: TutorStateType): Promise<Partial<TutorStateType>> {
  const content = state.responseContent?.trim();
  if (!content || content.length === 0) {
    throw new AppError("AI tutor generated an empty response", 502, "EMPTY_MODEL_RESPONSE");
  }

  return {
    responseContent: content,
  };
}

/**
 * Builds and compiles the LangGraph AI Tutor workflow.
 */
export function buildTutorGraph() {
  const workflow = new StateGraph(TutorStateAnnotation)
    .addNode("prepareContext", prepareContextNode)
    .addNode("generateTutorResponse", generateTutorResponseNode)
    .addNode("validateOutput", validateOutputNode)
    .addEdge(START, "prepareContext")
    .addEdge("prepareContext", "generateTutorResponse")
    .addEdge("generateTutorResponse", "validateOutput")
    .addEdge("validateOutput", END);

  return workflow.compile();
}

export const tutorGraph = buildTutorGraph();
