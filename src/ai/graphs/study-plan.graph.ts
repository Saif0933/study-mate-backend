import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import { BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createChatModel, shouldUseLiveAi } from "../model-factory";
import { z } from "zod";
import { STUDY_PLAN_SYSTEM_PROMPT, formatStudyPlanPrompt } from "../prompts/study-plan.prompts";
import { getEnv } from "../../config/env";
import { logger } from "../../utils/logger";
import { AppError } from "../../utils/errors";
import { GeneratedStudyTaskDraft } from "../../types/study-plan";

export const generatedTaskDraftSchema = z.object({
  dayOffset: z.number().int().min(0),
  title: z.string().trim().min(3, "Task title must be at least 3 characters"),
  topic: z.string().trim().min(1).optional(),
  description: z.string().trim().optional(),
  durationMinutes: z.number().int().min(5).max(720),
});

export const generatedTasksArraySchema = z.array(generatedTaskDraftSchema);

export const StudyPlanStateAnnotation = Annotation.Root({
  title: Annotation<string>(),
  subjects: Annotation<string[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),
  dailyMinutes: Annotation<number>({
    reducer: (_, next) => next,
    default: () => 60,
  }),
  totalDays: Annotation<number>({
    reducer: (_, next) => next,
    default: () => 7,
  }),
  examDate: Annotation<string | undefined>(),
  preferences: Annotation<Record<string, unknown> | undefined>(),
  rawContent: Annotation<string>({
    reducer: (_, next) => next,
    default: () => "",
  }),
  tasks: Annotation<GeneratedStudyTaskDraft[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),
  retryCount: Annotation<number>({
    reducer: (_, next) => next,
    default: () => 0,
  }),
  errorFeedback: Annotation<string | undefined>(),
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

export type StudyPlanStateType = typeof StudyPlanStateAnnotation.State;

/**
 * Deterministic study task generator for test/offline environments.
 */
export function generateDeterministicTasks(
  subjects: string[],
  totalDays: number,
  dailyMinutes: number
): GeneratedStudyTaskDraft[] {
  const taskList: GeneratedStudyTaskDraft[] = [];
  const validSubjects = subjects.length > 0 ? subjects : ["General Studies"];

  const taskTemplates = [
    { title: "Core Fundamentals & Theoretical Concepts", ratio: 0.6 },
    { title: "Targeted Practice Problems & Self-Assessment", ratio: 0.4 },
  ];

  for (let day = 0; day < totalDays; day++) {
    const subject = validSubjects[day % validSubjects.length]!;

    if (dailyMinutes <= 45) {
      // Single task per day
      taskList.push({
        dayOffset: day,
        title: `${subject} - Deep Review`,
        topic: subject,
        description: `Comprehensive study block on ${subject} key principles.`,
        durationMinutes: dailyMinutes,
      });
    } else {
      // Split into 2 tasks (e.g. concept + practice)
      const duration1 = Math.round(dailyMinutes * taskTemplates[0]!.ratio);
      const duration2 = dailyMinutes - duration1;

      taskList.push({
        dayOffset: day,
        title: `${subject} - ${taskTemplates[0]!.title}`,
        topic: subject,
        description: `Mastering essential theorems and foundational concepts in ${subject}.`,
        durationMinutes: duration1,
      });

      taskList.push({
        dayOffset: day,
        title: `${subject} - ${taskTemplates[1]!.title}`,
        topic: subject,
        description: `Solving application questions and active problem sets in ${subject}.`,
        durationMinutes: duration2,
      });
    }
  }

  return taskList;
}

/**
 * Node 1: Invokes LLM to generate plan tasks.
 */
export async function invokePlanModelNode(
  state: StudyPlanStateType
): Promise<Partial<StudyPlanStateType>> {
  const env = getEnv();
  const startTime = Date.now();

  if (!shouldUseLiveAi()) {
    const deterministic = generateDeterministicTasks(
      state.subjects,
      state.totalDays,
      state.dailyMinutes
    );
    const latencyMs = Math.max(1, Date.now() - startTime);

    return {
      tasks: deterministic,
      isValid: true,
      rawContent: JSON.stringify({ tasks: deterministic }),
      inputTokens: 40,
      outputTokens: 120,
      latencyMs,
    };
  }

  try {
    const promptText = formatStudyPlanPrompt({
      title: state.title,
      subjects: state.subjects,
      dailyMinutes: state.dailyMinutes,
      totalDays: state.totalDays,
      examDate: state.examDate,
      preferences: state.preferences,
    });

    const messages: BaseMessage[] = [new SystemMessage(STUDY_PLAN_SYSTEM_PROMPT)];

    if (state.errorFeedback) {
      messages.push(
        new HumanMessage(
          `Your previous output failed validation: ${state.errorFeedback}. Please regenerate the study tasks strictly adhering to the JSON schema.`
        )
      );
    } else {
      messages.push(new HumanMessage(promptText));
    }

    const model = createChatModel({
      temperature: 0.3,
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
    const inputTokens = usage?.input_tokens ?? Math.ceil(promptText.length / 4);
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
    logger.error({ err: errMessage, latencyMs }, "Study plan model invocation error");

    if (errMessage.includes("timeout") || errMessage.includes("ETIMEDOUT")) {
      throw new AppError("Study plan generation timed out. Please try again.", 504, "PROVIDER_TIMEOUT");
    }
    if (errMessage.includes("429") || errMessage.includes("quota")) {
      throw new AppError("AI provider rate limit exceeded. Please wait a moment.", 429, "PROVIDER_RATE_LIMIT");
    }

    throw new AppError("Failed to generate study plan via AI provider", 502, "PROVIDER_ERROR");
  }
}

/**
 * Node 2: Authoritative application-level validation of task dates, durations, and constraints.
 */
export async function validatePlanOutputNode(
  state: StudyPlanStateType
): Promise<Partial<StudyPlanStateType>> {
  if (state.isValid && state.tasks.length > 0) {
    return { isValid: true };
  }

  try {
    let parsed: unknown;
    try {
      parsed = JSON.parse(state.rawContent);
    } catch {
      const cleaned = state.rawContent.replace(/```json\s*|```\s*/g, "").trim();
      parsed = JSON.parse(cleaned);
    }

    const rawTasks = Array.isArray(parsed)
      ? parsed
      : (parsed as { tasks?: unknown[] }).tasks ||
        (parsed as { items?: unknown[] }).items;

    if (!Array.isArray(rawTasks) || rawTasks.length === 0) {
      return {
        isValid: false,
        errorFeedback: "Expected a non-empty 'tasks' array in JSON output.",
      };
    }

    const parseResult = generatedTasksArraySchema.safeParse(rawTasks);
    if (!parseResult.success) {
      const issues = parseResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      return {
        isValid: false,
        errorFeedback: `Validation failed: ${issues}`,
      };
    }

    // Authoritative schedule validation & correction:
    // 1. Clamp dayOffset to valid range [0, totalDays - 1]
    // 2. Ensure daily total duration does not exceed dailyMinutes (authoritative enforcement)
    const validDrafts: GeneratedStudyTaskDraft[] = [];
    const dailyDurationMap = new Map<number, number>();

    for (const draft of parseResult.data) {
      const day = Math.min(Math.max(0, draft.dayOffset), state.totalDays - 1);
      const currentDayTotal = dailyDurationMap.get(day) ?? 0;

      // If day budget is already full, skip or distribute to another day
      if (currentDayTotal >= state.dailyMinutes) {
        continue;
      }

      // Clamp task duration so it does not exceed remaining day budget
      const remainingBudget = state.dailyMinutes - currentDayTotal;
      const clampedDuration = Math.min(draft.durationMinutes, remainingBudget);

      if (clampedDuration >= 10) {
        validDrafts.push({
          dayOffset: day,
          title: draft.title,
          topic: draft.topic,
          description: draft.description,
          durationMinutes: clampedDuration,
        });
        dailyDurationMap.set(day, currentDayTotal + clampedDuration);
      }
    }

    if (validDrafts.length === 0) {
      return {
        isValid: false,
        errorFeedback: "No valid tasks could be extracted within the daily time budget constraints.",
      };
    }

    return {
      tasks: validDrafts,
      isValid: true,
      errorFeedback: undefined,
    };
  } catch (err) {
    return {
      isValid: false,
      errorFeedback: `JSON processing error: ${(err as Error).message}`,
    };
  }
}

/**
 * Conditional router: If output is invalid and retries are under limit, retry.
 */
export function shouldRetryPlanOrFinish(state: StudyPlanStateType): "invokePlanModel" | typeof END {
  if (state.isValid) {
    return END;
  }

  if (state.retryCount < 2) {
    logger.warn(
      { retryCount: state.retryCount, feedback: state.errorFeedback },
      "Retrying study plan generation due to invalid model output"
    );
    return "invokePlanModel";
  }

  throw new AppError(
    `Failed to generate valid study plan after multiple attempts: ${state.errorFeedback || "Invalid schedule"}`,
    502,
    "INVALID_MODEL_OUTPUT"
  );
}

/**
 * Builds the LangGraph workflow for Personalized Study Plan Generation.
 */
export function buildStudyPlanGraph() {
  const workflow = new StateGraph(StudyPlanStateAnnotation)
    .addNode("invokePlanModel", invokePlanModelNode)
    .addNode("validatePlanOutput", validatePlanOutputNode)
    .addEdge(START, "invokePlanModel")
    .addEdge("invokePlanModel", "validatePlanOutput")
    .addConditionalEdges("validatePlanOutput", shouldRetryPlanOrFinish);

  return workflow.compile();
}

export const studyPlanGraph = buildStudyPlanGraph();
