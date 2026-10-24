import { describe, it, expect } from "vitest";
import {
  evaluateEvidenceNode,
  validateSourcesNode,
  generateGroundedAnswerNode,
  DocumentQAStateType,
} from "../ai/graphs/document-qa.graph";
import { RetrievedChunk } from "../types/document";

describe("Document QA LangGraph Workflow (src/ai/graphs/document-qa.graph.ts)", () => {
  const dummyChunk: RetrievedChunk = {
    id: "chunk-123",
    documentId: "doc-123",
    userId: "user-123",
    chunkIndex: 0,
    pageNumber: 1,
    text: "Photosynthesis is the chemical reaction used by plants to convert light energy into chemical energy.",
    similarity: 0.85,
  };

  it("evaluateEvidenceNode detects sufficient evidence when high-similarity chunk is present", async () => {
    const state: DocumentQAStateType = {
      userId: "user-123",
      documentId: "doc-123",
      question: "What is photosynthesis?",
      retrievedChunks: [dummyChunk],
      hasSufficientEvidence: true,
      insufficientEvidence: false,
      answer: "",
      sources: [],
      confidence: undefined,
      modelId: "gpt-4o",
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
    };

    const result = await evaluateEvidenceNode(state);
    expect(result.hasSufficientEvidence).toBe(true);
    expect(result.insufficientEvidence).toBe(false);
  });

  it("evaluateEvidenceNode flags insufficient evidence when chunks list is empty", async () => {
    const state: DocumentQAStateType = {
      userId: "user-123",
      documentId: "doc-123",
      question: "What is quantum gravity?",
      retrievedChunks: [],
      hasSufficientEvidence: true,
      insufficientEvidence: false,
      answer: "",
      sources: [],
      confidence: undefined,
      modelId: "gpt-4o",
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
    };

    const result = await evaluateEvidenceNode(state);
    expect(result.hasSufficientEvidence).toBe(false);
    expect(result.insufficientEvidence).toBe(true);
    expect(result.answer).toContain("could not find sufficient information");
    expect(result.sources).toEqual([]);
    expect(result.confidence).toBe("LOW");
  });

  it("evaluateEvidenceNode flags insufficient evidence when chunk similarity is negligible (< 0.10)", async () => {
    const lowSimChunk: RetrievedChunk = {
      ...dummyChunk,
      similarity: 0.04,
    };

    const state: DocumentQAStateType = {
      userId: "user-123",
      documentId: "doc-123",
      question: "What is the capital of Mars?",
      retrievedChunks: [lowSimChunk],
      hasSufficientEvidence: true,
      insufficientEvidence: false,
      answer: "",
      sources: [],
      confidence: undefined,
      modelId: "gpt-4o",
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
    };

    const result = await evaluateEvidenceNode(state);
    expect(result.hasSufficientEvidence).toBe(false);
    expect(result.insufficientEvidence).toBe(true);
  });

  it("validateSourcesNode produces structured citations referencing actual retrieved chunks", async () => {
    const state: DocumentQAStateType = {
      userId: "user-123",
      documentId: "doc-123",
      question: "Explain photosynthesis",
      retrievedChunks: [dummyChunk],
      hasSufficientEvidence: true,
      insufficientEvidence: false,
      answer: "Photosynthesis converts light into chemical energy.",
      sources: [],
      confidence: undefined,
      modelId: "gpt-4o",
      inputTokens: 10,
      outputTokens: 10,
      latencyMs: 50,
    };

    const result = await validateSourcesNode(state);
    expect(result.sources).toHaveLength(1);
    expect(result.sources![0]!.documentId).toBe("doc-123");
    expect(result.sources![0]!.page).toBe(1);
    expect(result.sources![0]!.chunkId).toBe("chunk-123");
    expect(result.sources![0]!.excerpt).toContain("Photosynthesis");
    expect(result.confidence).toBe("HIGH");
  });

  it("validateSourcesNode returns empty sources array when evidence is insufficient", async () => {
    const state: DocumentQAStateType = {
      userId: "user-123",
      documentId: "doc-123",
      question: "Irrelevant question",
      retrievedChunks: [dummyChunk],
      hasSufficientEvidence: false,
      insufficientEvidence: true,
      answer: "No sufficient evidence.",
      sources: [],
      confidence: undefined,
      modelId: "gpt-4o",
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
    };

    const result = await validateSourcesNode(state);
    expect(result.sources).toEqual([]);
    expect(result.confidence).toBe("LOW");
  });

  it("generateGroundedAnswerNode skips LLM when hasSufficientEvidence is false", async () => {
    const state: DocumentQAStateType = {
      userId: "user-123",
      documentId: "doc-123",
      question: "Irrelevant query",
      retrievedChunks: [],
      hasSufficientEvidence: false,
      insufficientEvidence: true,
      answer: "Already answered",
      sources: [],
      confidence: undefined,
      modelId: "gpt-4o",
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
    };

    const result = await generateGroundedAnswerNode(state);
    expect(result).toEqual({});
  });
});
