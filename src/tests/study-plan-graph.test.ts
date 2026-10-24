import { describe, it, expect } from "vitest";
import {
  generateDeterministicTasks,
  validatePlanOutputNode,
  shouldRetryPlanOrFinish,
  StudyPlanStateType,
} from "../ai/graphs/study-plan.graph";

describe("Study Plan Generator LangGraph Workflow (src/ai/graphs/study-plan.graph.ts)", () => {
  it("generateDeterministicTasks balances tasks across subjects and respects daily time budget", () => {
    const subjects = ["Physics", "Chemistry", "Mathematics"];
    const totalDays = 7;
    const dailyMinutes = 90;

    const tasks = generateDeterministicTasks(subjects, totalDays, dailyMinutes);

    expect(tasks.length).toBeGreaterThanOrEqual(totalDays);

    // Group tasks by dayOffset
    const dayMap = new Map<number, number>();
    for (const task of tasks) {
      expect(task.dayOffset).toBeGreaterThanOrEqual(0);
      expect(task.dayOffset).toBeLessThan(totalDays);
      expect(task.durationMinutes).toBeGreaterThan(0);
      const cur = dayMap.get(task.dayOffset) ?? 0;
      dayMap.set(task.dayOffset, cur + task.durationMinutes);
    }

    // Verify each day's total duration equals dailyMinutes
    for (let day = 0; day < totalDays; day++) {
      expect(dayMap.get(day)).toBe(dailyMinutes);
    }
  });

  it("validatePlanOutputNode authoritatively clamps task duration to daily budget", async () => {
    const excessiveTasks = [
      {
        dayOffset: 0,
        title: "Overloaded Task 1",
        topic: "Physics",
        description: "Study block",
        durationMinutes: 120, // Exceeds dailyMinutes of 60
      },
    ];

    const state: StudyPlanStateType = {
      title: "Crash Course",
      subjects: ["Physics"],
      dailyMinutes: 60,
      totalDays: 3,
      examDate: undefined,
      preferences: undefined,
      rawContent: JSON.stringify({ tasks: excessiveTasks }),
      tasks: [],
      retryCount: 0,
      errorFeedback: undefined,
      isValid: false,
      modelId: "gpt-4o",
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
    };

    const result = await validatePlanOutputNode(state);
    expect(result.isValid).toBe(true);
    expect(result.tasks).toHaveLength(1);
    // Crucially: duration clamped to 60 minutes
    expect(result.tasks![0]!.durationMinutes).toBe(60);
  });

  it("validatePlanOutputNode clamps dayOffset to valid range [0, totalDays - 1]", async () => {
    const outOfBoundsTasks = [
      {
        dayOffset: 99, // Way beyond totalDays of 3
        title: "Future Task",
        topic: "Physics",
        description: "Deep study",
        durationMinutes: 30,
      },
    ];

    const state: StudyPlanStateType = {
      title: "Plan",
      subjects: ["Physics"],
      dailyMinutes: 60,
      totalDays: 3,
      examDate: undefined,
      preferences: undefined,
      rawContent: JSON.stringify({ tasks: outOfBoundsTasks }),
      tasks: [],
      retryCount: 0,
      errorFeedback: undefined,
      isValid: false,
      modelId: "gpt-4o",
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
    };

    const result = await validatePlanOutputNode(state);
    expect(result.isValid).toBe(true);
    expect(result.tasks![0]!.dayOffset).toBe(2); // Clamped to totalDays - 1
  });

  it("shouldRetryPlanOrFinish triggers model retry when output is invalid and retryCount < 2", () => {
    const state: StudyPlanStateType = {
      title: "Plan",
      subjects: ["Math"],
      dailyMinutes: 60,
      totalDays: 5,
      examDate: undefined,
      preferences: undefined,
      rawContent: "invalid json",
      tasks: [],
      retryCount: 1,
      isValid: false,
      errorFeedback: "Invalid format",
      modelId: "gpt-4o",
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
    };

    const nextNode = shouldRetryPlanOrFinish(state);
    expect(nextNode).toBe("invokePlanModel");
  });

  it("shouldRetryPlanOrFinish throws AppError when retries are exhausted", () => {
    const state: StudyPlanStateType = {
      title: "Plan",
      subjects: ["Math"],
      dailyMinutes: 60,
      totalDays: 5,
      examDate: undefined,
      preferences: undefined,
      rawContent: "invalid json",
      tasks: [],
      retryCount: 2,
      isValid: false,
      errorFeedback: "Retries exhausted",
      modelId: "gpt-4o",
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
    };

    expect(() => shouldRetryPlanOrFinish(state)).toThrow(/Failed to generate valid study plan/);
  });
});
