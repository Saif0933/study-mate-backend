import { describe, it, expect } from "vitest";
import {
  prepareContextNode,
  validateOutputNode,
  buildTutorGraph,
  TutorStateType,
} from "../ai/graphs/tutor.graph";
import { getTutorPromptForMode } from "../ai/prompts/tutor.prompts";
import { AppError } from "../utils/errors";

describe("LangGraph AI Tutor Workflow", () => {
  describe("prepareContextNode", () => {
    it("injects mode-specific system prompt and bounds conversation history", async () => {
      const state = {
        userId: "user-123",
        conversationId: "conv-123",
        userMessage: "What is photosynthesis?",
        imageBase64: undefined,
        explanationMode: "simple",
        history: [
          { role: "user", content: "Hi" },
          { role: "assistant", content: "Hello! How can I help?" },
          { role: "user", content: "I want to study biology." },
          { role: "assistant", content: "Great! Which topic?" },
        ],
        boundedMessages: [],
        responseContent: "",
        modelId: "gpt-4o",
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
        error: undefined,
      } as TutorStateType;

      const result = await prepareContextNode(state);

      expect(result.boundedMessages).toBeDefined();
      expect(result.boundedMessages!.length).toBe(6); // 1 system + 4 history + 1 current message
      expect(result.boundedMessages![0]._getType()).toBe("system");
      expect(result.boundedMessages![0].content).toContain("Explanation Mode: SIMPLE");
      expect(result.boundedMessages![result.boundedMessages!.length - 1].content).toBe(
        "What is photosynthesis?"
      );
    });

    it("generates detailed mode instructions when detailed mode is requested", () => {
      const prompt = getTutorPromptForMode("detailed");
      expect(prompt).toContain("Explanation Mode: DETAILED");
      expect(prompt).toContain("in-depth, rigorous breakdown");
    });

    it("generates examples mode instructions when examples mode is requested", () => {
      const prompt = getTutorPromptForMode("examples");
      expect(prompt).toContain("Explanation Mode: EXAMPLES");
      expect(prompt).toContain("step-by-step walkthroughs");
    });
  });

  describe("validateOutputNode", () => {
    it("passes through valid trimmed response", async () => {
      const state = {
        responseContent: "  Photosynthesis is the process plants use to convert light into energy.  ",
      } as TutorStateType;

      const result = await validateOutputNode(state);
      expect(result.responseContent).toBe(
        "Photosynthesis is the process plants use to convert light into energy."
      );
    });

    it("throws AppError when model response is empty or blank", async () => {
      const state = {
        responseContent: "   ",
      } as TutorStateType;

      await expect(validateOutputNode(state)).rejects.toThrow(AppError);
    });
  });

  describe("Full Tutor Workflow Graph Execution", () => {
    it("compiles and runs successfully end-to-end", async () => {
      const graph = buildTutorGraph();

      const result = await graph.invoke({
        userId: "user-test",
        conversationId: "conv-test",
        userMessage: "Explain gravity in simple terms",
        explanationMode: "simple",
        history: [],
      });

      expect(result.responseContent).toBeDefined();
      expect(result.responseContent.length).toBeGreaterThan(0);
      expect(result.inputTokens).toBeGreaterThan(0);
      expect(result.outputTokens).toBeGreaterThan(0);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("handles multimodal imageBase64 input successfully end-to-end", async () => {
      const graph = buildTutorGraph();

      const result = await graph.invoke({
        userId: "user-test",
        conversationId: "conv-test",
        userMessage: "Solve question 2 in this diagram",
        imageBase64: "data:image/jpeg;base64,dGVzdGltYWdlZGF0YQ==",
        explanationMode: "detailed",
        history: [],
      });

      expect(result.responseContent).toBeDefined();
      expect(result.responseContent).toContain("analyzed the uploaded image");
      expect(result.inputTokens).toBeGreaterThan(0);
      expect(result.outputTokens).toBeGreaterThan(0);
    });
  });
});
