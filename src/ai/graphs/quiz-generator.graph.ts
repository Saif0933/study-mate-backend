import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import { BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createChatModel, shouldUseLiveAi } from "../model-factory";
import { z } from "zod";
import { QUIZ_GENERATION_SYSTEM_PROMPT, formatQuizPrompt } from "../prompts/quiz.prompts";
import { getEnv } from "../../config/env";
import { logger } from "../../utils/logger";
import { AppError } from "../../utils/errors";
import { GeneratedQuizQuestion } from "../../types/quiz";

// Strict runtime schema for each generated question
export const generatedQuestionSchema = z
  .object({
    orderIndex: z.number().int().positive(),
    prompt: z.string().trim().min(5, "Prompt must be at least 5 characters"),
    options: z
      .array(z.string().trim().min(1, "Option cannot be empty"))
      .min(2, "Must have at least 2 options")
      .max(6, "Cannot have more than 6 options")
      .refine(
        (opts) => {
          const lower = opts.map((o) => o.toLowerCase());
          return new Set(lower).size === opts.length;
        },
        { message: "Question options must be distinct" }
      ),
    correctAnswer: z.string().trim().min(1, "Correct answer is required"),
    explanation: z.string().trim().min(5, "Explanation must be at least 5 characters"),
  })
  .refine(
    (q) => {
      const match = q.options.some(
        (opt) => opt.trim().toLowerCase() === q.correctAnswer.trim().toLowerCase()
      );
      return match;
    },
    { message: "correctAnswer must exactly match one of the options" }
  );

export const generatedQuizOutputSchema = z.array(generatedQuestionSchema);

export const QuizGeneratorStateAnnotation = Annotation.Root({
  topic: Annotation<string | undefined>(),
  documentContext: Annotation<string | undefined>(),
  difficulty: Annotation<string>({
    reducer: (_, next) => next,
    default: () => "MEDIUM",
  }),
  questionCount: Annotation<number>({
    reducer: (_, next) => next,
    default: () => 5,
  }),
  rawContent: Annotation<string>({
    reducer: (_, next) => next,
    default: () => "",
  }),
  questions: Annotation<GeneratedQuizQuestion[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),
  retryCount: Annotation<number>({
    reducer: (_, next) => next,
    default: () => 0,
  }),
  errorFeedback: Annotation<string | undefined>({
    reducer: (_, next) => next,
  }),
  isValid: Annotation<boolean>({
    reducer: (_, next) => next,
    default: () => false,
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
});

export type QuizGeneratorStateType = typeof QuizGeneratorStateAnnotation.State;

/**
 * Generates deterministic fallback quiz questions for testing/offline environments.
 */
export function generateDeterministicQuestions(
  topicOrSubject: string,
  questionCount: number,
  difficulty: string
): GeneratedQuizQuestion[] {
  const baseQuestions: Array<{
    prompt: string;
    options: string[];
    correctAnswer: string;
    explanation: string;
  }> = [
    {
      prompt: `What is the primary foundational concept of ${topicOrSubject}?`,
      options: [
        `The fundamental governing principle of ${topicOrSubject}`,
        "An unrelated secondary phenomenon",
        "An unverified speculative hypothesis",
        "A deprecated historical concept",
      ],
      correctAnswer: `The fundamental governing principle of ${topicOrSubject}`,
      explanation: `In ${topicOrSubject}, core principles form the foundation for all subsequent applications and analyses.`,
    },
    {
      prompt: `Which of the following best describes the key mechanism in ${topicOrSubject}?`,
      options: [
        "A random sequence of isolated events",
        `A structured, systematic process central to ${topicOrSubject}`,
        "An irreversible loss of structural integrity",
        "A static state with zero energy exchange",
      ],
      correctAnswer: `A structured, systematic process central to ${topicOrSubject}`,
      explanation: `${topicOrSubject} relies on structured interactions to function predictably according to theory.`,
    },
    {
      prompt: `Under ${difficulty.toLowerCase()} conditions, how does ${topicOrSubject} maintain stability?`,
      options: [
        "By ignoring external fluctuations",
        "Through passive decay over extended time",
        `By regulated feedback loops and equilibrium mechanisms`,
        "By continuous exponential expansion",
      ],
      correctAnswer: `By regulated feedback loops and equilibrium mechanisms`,
      explanation: "Equilibrium and feedback loops are essential for stability under tested operating conditions.",
    },
    {
      prompt: `What critical factor differentiates modern understanding of ${topicOrSubject}?`,
      options: [
        "Complete abandonment of empirical observation",
        "Strict adherence to obsolete 19th-century paradigms",
        `Empirical data validation and quantitative modeling`,
        "Exclusively qualitative conjecture without evidence",
      ],
      correctAnswer: `Empirical data validation and quantitative modeling`,
      explanation: "Modern scientific frameworks emphasize rigorous quantitative modeling and verification.",
    },
    {
      prompt: `What is the most likely consequence of a breakdown in ${topicOrSubject}?`,
      options: [
        "Instantaneous spontaneous reorganization",
        `System failure or degraded functional performance`,
        "Zero measurable impact on system equilibrium",
        "Exponential multiplication of available energy",
      ],
      correctAnswer: `System failure or degraded functional performance`,
      explanation: "Disruption of fundamental operations leads directly to diminished overall function.",
    },
  ];

  const results: GeneratedQuizQuestion[] = [];
  for (let i = 0; i < questionCount; i++) {
    const template = baseQuestions[i % baseQuestions.length]!;
    results.push({
      orderIndex: i + 1,
      prompt: i >= baseQuestions.length ? `${template.prompt} (Part ${Math.floor(i / baseQuestions.length) + 1})` : template.prompt,
      options: [...template.options],
      correctAnswer: template.correctAnswer,
      explanation: template.explanation,
    });
  }

  return results;
}

/**
 * Node 1: Invokes LLM with structured prompt.
 */
export async function invokeQuizModelNode(
  state: QuizGeneratorStateType
): Promise<Partial<QuizGeneratorStateType>> {
  const env = getEnv();
  const startTime = Date.now();

  const subject = state.topic || (state.documentContext ? "the provided document" : "General Knowledge");

  if (!shouldUseLiveAi()) {
    const deterministicQuestions = generateDeterministicQuestions(
      subject,
      state.questionCount,
      state.difficulty
    );
    const latencyMs = Math.max(1, Date.now() - startTime);

    return {
      questions: deterministicQuestions,
      isValid: true,
      rawContent: JSON.stringify(deterministicQuestions),
      inputTokens: 50,
      outputTokens: 150,
      latencyMs,
    };
  }

  try {
    const userPromptText = formatQuizPrompt({
      topic: state.topic,
      documentContext: state.documentContext,
      difficulty: state.difficulty,
      questionCount: state.questionCount,
    });

    const messages: BaseMessage[] = [new SystemMessage(QUIZ_GENERATION_SYSTEM_PROMPT)];

    if (state.errorFeedback) {
      messages.push(
        new HumanMessage(
          `Your previous output failed validation: ${state.errorFeedback}. Please regenerate the exact ${state.questionCount} questions conforming strictly to the JSON schema.`
        )
      );
    } else {
      messages.push(new HumanMessage(userPromptText));
    }

    const model = createChatModel({
      temperature: 0.4,
      maxTokens: 3000,
      modelKwargs: {
        response_format: { type: "json_object" },
      },
    });

    const response = await model.invoke(messages);
    const latencyMs = Date.now() - startTime;
    const content =
      typeof response.content === "string" ? response.content : JSON.stringify(response.content);

    const usage = response.usage_metadata;
    const inputTokens = usage?.input_tokens ?? Math.ceil(userPromptText.length / 4);
    const outputTokens = usage?.output_tokens ?? Math.ceil(content.length / 4);

    return {
      rawContent: content,
      inputTokens,
      outputTokens,
      latencyMs,
      retryCount: state.retryCount + 1,
    };
  } catch (error: unknown) {
    const latencyMs = Date.now() - startTime;
    const errMessage = error instanceof Error ? error.message : String(error);
    logger.error({ err: errMessage, latencyMs }, "Quiz generator model invocation error");

    if (errMessage.includes("timeout") || errMessage.includes("ETIMEDOUT")) {
      throw new AppError("Quiz generation timed out. Please try again.", 504, "PROVIDER_TIMEOUT");
    }
    if (errMessage.includes("429") || errMessage.includes("quota")) {
      throw new AppError("AI provider rate limit exceeded. Please wait a moment.", 429, "PROVIDER_RATE_LIMIT");
    }

    throw new AppError("Failed to generate quiz questions via AI provider", 502, "PROVIDER_ERROR");
  }
}

/**
 * Node 2: Validates generated questions against strict runtime schema.
 */
export async function validateQuizOutputNode(
  state: QuizGeneratorStateType
): Promise<Partial<QuizGeneratorStateType>> {
  // If already marked valid (e.g. from offline generator)
  if (state.isValid && state.questions.length > 0) {
    return { isValid: true };
  }

  try {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(state.rawContent);
    } catch {
      // Strip markdown code fences if model enclosed in ```json ... ```
      const cleaned = state.rawContent.replace(/```json\s*|```\s*/g, "").trim();
      parsedJson = JSON.parse(cleaned);
    }

    // In case model returned an object with { questions: [...] }
    const questionsArray = Array.isArray(parsedJson)
      ? parsedJson
      : (parsedJson as { questions?: unknown[] }).questions ||
        (parsedJson as { items?: unknown[] }).items;

    if (!Array.isArray(questionsArray)) {
      return {
        isValid: false,
        errorFeedback: "Expected a JSON array of questions, but received a non-array response.",
      };
    }

    if (questionsArray.length !== state.questionCount) {
      return {
        isValid: false,
        errorFeedback: `Expected exactly ${state.questionCount} questions, but received ${questionsArray.length}.`,
      };
    }

    const parseResult = generatedQuizOutputSchema.safeParse(questionsArray);
    if (!parseResult.success) {
      const issueMsgs = parseResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      return {
        isValid: false,
        errorFeedback: `Validation failed: ${issueMsgs}`,
      };
    }

    // Ensure order indices are sequenced 1..N
    const validQuestions: GeneratedQuizQuestion[] = parseResult.data.map((q, idx) => ({
      ...q,
      orderIndex: idx + 1,
    }));

    return {
      questions: validQuestions,
      isValid: true,
      errorFeedback: undefined,
    };
  } catch (parseError) {
    const msg = (parseError as Error).message;
    return {
      isValid: false,
      errorFeedback: `JSON parse error: ${msg}`,
    };
  }
}

/**
 * Conditional router: If output is invalid and retries are under limit, retry.
 */
export function shouldRetryOrFinish(state: QuizGeneratorStateType): "invokeQuizModel" | typeof END {
  if (state.isValid) {
    return END;
  }

  // Bounded retries: maximum 2 attempts
  if (state.retryCount < 2) {
    logger.warn(
      { retryCount: state.retryCount, feedback: state.errorFeedback },
      "Retrying quiz generation due to invalid model output"
    );
    return "invokeQuizModel";
  }

  // If retries exhausted and still invalid, throw structured error
  throw new AppError(
    `Failed to generate valid quiz questions after multiple attempts: ${state.errorFeedback || "Invalid output"}`,
    502,
    "INVALID_MODEL_OUTPUT"
  );
}

/**
 * Builds the LangGraph workflow for AI Quiz Generation.
 */
export function buildQuizGeneratorGraph() {
  const workflow = new StateGraph(QuizGeneratorStateAnnotation)
    .addNode("invokeQuizModel", invokeQuizModelNode)
    .addNode("validateQuizOutput", validateQuizOutputNode)
    .addEdge(START, "invokeQuizModel")
    .addEdge("invokeQuizModel", "validateQuizOutput")
    .addConditionalEdges("validateQuizOutput", shouldRetryOrFinish);

  return workflow.compile();
}

export const quizGeneratorGraph = buildQuizGeneratorGraph();
