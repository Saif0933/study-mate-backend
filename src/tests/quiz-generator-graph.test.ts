import { describe, it, expect } from "vitest";
import {
  generateDeterministicQuestions,
  validateQuizOutputNode,
  shouldRetryOrFinish,
  QuizGeneratorStateType,
} from "../ai/graphs/quiz-generator.graph";

describe("Quiz Generator LangGraph Workflow (src/ai/graphs/quiz-generator.graph.ts)", () => {
  it("generateDeterministicQuestions produces exact question count with distinct options and valid answer keys", () => {
    const count = 5;
    const questions = generateDeterministicQuestions("Neuroscience", count, "MEDIUM");

    expect(questions).toHaveLength(count);

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i]!;
      expect(q.orderIndex).toBe(i + 1);
      expect(q.prompt.length).toBeGreaterThan(5);
      expect(q.options.length).toBe(4);
      // Ensure all options are distinct
      const uniqueOpts = new Set(q.options);
      expect(uniqueOpts.size).toBe(4);
      // Ensure correctAnswer exactly matches one of the options
      expect(q.options).toContain(q.correctAnswer);
      expect(q.explanation.length).toBeGreaterThan(5);
    }
  });

  it("validateQuizOutputNode passes valid JSON array matching requested count", async () => {
    const validQuestions = [
      {
        orderIndex: 1,
        prompt: "What is mitochondria?",
        options: ["Powerhouse of cell", "Control center", "Storage unit", "Cell wall"],
        correctAnswer: "Powerhouse of cell",
        explanation: "Mitochondria produce ATP through cellular respiration.",
      },
    ];

    const state: QuizGeneratorStateType = {
      topic: undefined,
      documentContext: undefined,
      difficulty: "MEDIUM",
      questionCount: 1,
      rawContent: JSON.stringify(validQuestions),
      questions: [],
      retryCount: 0,
      errorFeedback: undefined,
      isValid: false,
      modelId: "gpt-4o",
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
    };

    const result = await validateQuizOutputNode(state);
    expect(result.isValid).toBe(true);
    expect(result.questions).toHaveLength(1);
    expect(result.questions![0]!.prompt).toBe("What is mitochondria?");
  });

  it("validateQuizOutputNode rejects output with incorrect question count", async () => {
    const partialQuestions = [
      {
        orderIndex: 1,
        prompt: "Question 1",
        options: ["A", "B", "C", "D"],
        correctAnswer: "A",
        explanation: "Explanation 1",
      },
    ];

    const state: QuizGeneratorStateType = {
      topic: undefined,
      documentContext: undefined,
      difficulty: "MEDIUM",
      questionCount: 3, // Expected 3, provided 1
      rawContent: JSON.stringify(partialQuestions),
      questions: [],
      retryCount: 0,
      errorFeedback: undefined,
      isValid: false,
      modelId: "gpt-4o",
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
    };

    const result = await validateQuizOutputNode(state);
    expect(result.isValid).toBe(false);
    expect(result.errorFeedback).toContain("Expected exactly 3 questions");
  });

  it("validateQuizOutputNode rejects output where correctAnswer is not among options", async () => {
    const invalidQuestions = [
      {
        orderIndex: 1,
        prompt: "What is the speed of light?",
        options: ["100 km/s", "200 km/s", "300 km/s", "400 km/s"],
        correctAnswer: "299,792 km/s", // Not in options
        explanation: "Speed of light is approximately 300,000 km/s.",
      },
    ];

    const state: QuizGeneratorStateType = {
      topic: undefined,
      documentContext: undefined,
      difficulty: "MEDIUM",
      questionCount: 1,
      rawContent: JSON.stringify(invalidQuestions),
      questions: [],
      retryCount: 0,
      errorFeedback: undefined,
      isValid: false,
      modelId: "gpt-4o",
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
    };

    const result = await validateQuizOutputNode(state);
    expect(result.isValid).toBe(false);
    expect(result.errorFeedback).toContain("correctAnswer must exactly match");
  });

  it("shouldRetryOrFinish triggers model retry when output is invalid and retryCount < 2", () => {
    const state: QuizGeneratorStateType = {
      topic: undefined,
      documentContext: undefined,
      difficulty: "MEDIUM",
      questionCount: 5,
      rawContent: "invalid json",
      questions: [],
      retryCount: 1, // First retry
      isValid: false,
      errorFeedback: "JSON parse error",
      modelId: "gpt-4o",
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
    };

    const nextNode = shouldRetryOrFinish(state);
    expect(nextNode).toBe("invokeQuizModel");
  });

  it("shouldRetryOrFinish throws AppError when retries are exhausted", () => {
    const state: QuizGeneratorStateType = {
      topic: undefined,
      documentContext: undefined,
      difficulty: "MEDIUM",
      questionCount: 5,
      rawContent: "invalid json",
      questions: [],
      retryCount: 2, // Retries exhausted
      isValid: false,
      errorFeedback: "Invalid schema",
      modelId: "gpt-4o",
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
    };

    expect(() => shouldRetryOrFinish(state)).toThrow(/Failed to generate valid quiz questions/);
  });
});
