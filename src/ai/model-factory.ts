import { ChatOpenAI } from "@langchain/openai";
import { getEnv } from "../config/env";
import { logger } from "../utils/logger";

export interface CreateChatModelOptions {
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
  maxRetries?: number;
  modelKwargs?: Record<string, unknown>;
}

/**
 * Creates and configures a ChatOpenAI model instance.
 * Automatically detects Google Gemini API keys (including AQ. and AIzaSy formats)
 * and seamlessly routes requests through Google's official OpenAI-compatible endpoint.
 */
export function createChatModel(options: CreateChatModelOptions = {}): ChatOpenAI {
  const env = getEnv();
  const rawKey = env.GEMINI_API_KEY || env.OPENAI_API_KEY || "";

  // Detect if this is a Google Gemini key
  const isGeminiKey =
    rawKey.startsWith("AQ.") ||
    rawKey.startsWith("AIzaSy") ||
    Boolean(env.GEMINI_API_KEY) ||
    Boolean(env.OPENAI_BASE_URL?.includes("generativelanguage.googleapis.com"));

  let modelName = env.OPENAI_MODEL;
  let baseURL = env.OPENAI_BASE_URL;

  if (isGeminiKey) {
    if (!baseURL) {
      baseURL = "https://generativelanguage.googleapis.com/v1beta/openai";
    }
    // Normalize modelName if it's an OpenAI default or a UI label like "Gemini API Key"
    if (
      !modelName ||
      modelName.includes(" ") ||
      modelName.startsWith("gpt-") ||
      modelName === "Gemini API Key"
    ) {
      modelName = "gemini-3.1-flash-lite";
    }
  }

  logger.debug(
    { isGeminiKey, modelName, hasBaseURL: Boolean(baseURL) },
    "Instantiating Chat LLM model"
  );

  return new ChatOpenAI({
    apiKey: rawKey,
    openAIApiKey: rawKey,
    modelName,
    temperature: options.temperature ?? env.AI_TUTOR_TEMPERATURE,
    maxTokens: options.maxTokens ?? env.AI_TUTOR_MAX_TOKENS,
    timeout: options.timeout ?? env.AI_TUTOR_TIMEOUT_MS,
    maxRetries: options.maxRetries ?? env.AI_TUTOR_MAX_RETRIES,
    modelKwargs: options.modelKwargs,
    configuration: baseURL ? { baseURL } : undefined,
  });
}

/**
 * Checks whether live AI calls should be made.
 * Returns true if a valid, non-placeholder API key exists AND we are not in a Vitest/test environment (unless FORCE_LIVE_AI is set).
 */
export function shouldUseLiveAi(): boolean {
  if (process.env.FORCE_LIVE_AI === "true") {
    return true;
  }

  if (process.env.NODE_ENV === "test" || process.env.VITEST) {
    return false;
  }

  const env = getEnv();
  const rawKey = env.GEMINI_API_KEY || env.OPENAI_API_KEY;
  return Boolean(
    rawKey &&
    rawKey.trim().length > 0 &&
    !rawKey.includes("placeholder")
  );
}
