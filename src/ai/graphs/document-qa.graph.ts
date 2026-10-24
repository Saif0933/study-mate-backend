import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import { BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createChatModel, shouldUseLiveAi } from "../model-factory";
import { DOCUMENT_QA_SYSTEM_PROMPT, formatDocumentContext } from "../prompts/document-qa.prompts";
import { documentRetriever } from "../retrievers/document.retriever";
import { getEnv } from "../../config/env";
import { logger } from "../../utils/logger";
import { AppError } from "../../utils/errors";
import { RetrievedChunk, DocumentCitationResponse } from "../../types/document";

export const DocumentQAStateAnnotation = Annotation.Root({
  userId: Annotation<string>(),
  documentId: Annotation<string>(),
  question: Annotation<string>(),
  retrievedChunks: Annotation<RetrievedChunk[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),
  hasSufficientEvidence: Annotation<boolean>({
    reducer: (_, next) => next,
    default: () => true,
  }),
  insufficientEvidence: Annotation<boolean>({
    reducer: (_, next) => next,
    default: () => false,
  }),
  answer: Annotation<string>({
    reducer: (_, next) => next,
    default: () => "",
  }),
  sources: Annotation<DocumentCitationResponse[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),
  confidence: Annotation<string | undefined>({
    reducer: (_, next) => next,
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

export type DocumentQAStateType = typeof DocumentQAStateAnnotation.State;

/**
 * Detects whether a query is requesting a synthesis, summary, overview, or generative questions
 * (e.g. interview questions, quizzes, study notes) based on the uploaded document.
 */
export function isDocumentLevelQuery(question: string): boolean {
  if (!question) return false;
  const q = question.toLowerCase().trim();

  const broadPatterns = [
    /\binterview\b/i,
    /\bsummar(y|ize|ise)\b/i,
    /\boverview\b/i,
    /\bkey (points|topics|takeaways|concepts|skills)\b/i,
    /\b(main|core) (topics|points|ideas|concepts)\b/i,
    /\b(practice|study|quiz|test|sample) questions?\b/i,
    /\bwhat is this (pdf|document|resume|file) about\b/i,
    /\bexplain this (pdf|document|resume|file)\b/i,
    /\btell me about this (pdf|document|resume|file)\b/i,
    /\b(about|from|in) this (pdf|document|resume|file)\b/i,
    /\baccording to this (pdf|document|resume|file)\b/i,
    /\bbased on this (pdf|document|resume|file)\b/i,
  ];

  return broadPatterns.some((pattern) => pattern.test(q));
}

/**
 * Node 1: Semantic Retrieval via pgvector filtered by user and document
 */
export async function retrieveChunksNode(
  state: DocumentQAStateType
): Promise<Partial<DocumentQAStateType>> {
  const isDocLevel = isDocumentLevelQuery(state.question);

  if (isDocLevel) {
    // For document-level synthesis (interview questions, summaries, study topics),
    // retrieve chronological document chunks to supply comprehensive context.
    const docChunks = await documentRetriever.getDocumentChunks(
      state.userId,
      state.documentId,
      6
    );
    if (docChunks.length > 0) {
      return {
        retrievedChunks: docChunks,
      };
    }
  }

  const queryEmbedding = await documentRetriever.generateEmbedding(state.question);
  const chunks = await documentRetriever.retrieveChunks(
    state.userId,
    state.documentId,
    queryEmbedding,
    4
  );

  return {
    retrievedChunks: chunks,
  };
}

/**
 * Node 2: Evidence Evaluation - checks chunk availability and similarity threshold
 */
export async function evaluateEvidenceNode(
  state: DocumentQAStateType
): Promise<Partial<DocumentQAStateType>> {
  const chunks = state.retrievedChunks;

  // If no chunks retrieved at all
  if (!chunks || chunks.length === 0) {
    return {
      hasSufficientEvidence: false,
      insufficientEvidence: true,
      answer: "I could not find sufficient information in this document to answer your question.",
      sources: [],
      confidence: "LOW",
    };
  }

  const isDocLevel = isDocumentLevelQuery(state.question);

  // For specific factual questions, check if similarity is negligible (< 0.10)
  if (!isDocLevel && chunks[0] && chunks[0].similarity < 0.10) {
    return {
      hasSufficientEvidence: false,
      insufficientEvidence: true,
      answer: "I could not find sufficient information in this document to answer your question.",
      sources: [],
      confidence: "LOW",
    };
  }

  return {
    hasSufficientEvidence: true,
    insufficientEvidence: false,
  };
}

/**
 * Node 3: Grounded Answer Generation via OpenAI or deterministic offline fallback
 */
export async function generateGroundedAnswerNode(
  state: DocumentQAStateType
): Promise<Partial<DocumentQAStateType>> {
  // If already identified as lacking evidence, do not call LLM
  if (!state.hasSufficientEvidence) {
    return {};
  }

  const env = getEnv();
  const startTime = Date.now();
  const chunks = state.retrievedChunks;

  if (!shouldUseLiveAi()) {
    // Offline / testing fallback grounded on top retrieved chunk
    const topChunk = chunks[0]!;
    const latencyMs = Math.max(1, Date.now() - startTime);

    const answer = `Based on the document (page ${topChunk.pageNumber ?? 1}): ${topChunk.text}`;
    return {
      answer,
      inputTokens: Math.ceil((state.question.length + topChunk.text.length) / 4),
      outputTokens: Math.ceil(answer.length / 4),
      latencyMs,
    };
  }

  try {
    const formattedContext = formatDocumentContext(chunks);
    const messages: BaseMessage[] = [
      new SystemMessage(DOCUMENT_QA_SYSTEM_PROMPT),
      new HumanMessage(
        `Document Context:\n${formattedContext}\n\nStudent Question: ${state.question}`
      ),
    ];

    const model = createChatModel({
      temperature: 0.2, // Low temperature for high factual grounding
      maxTokens: 1024,
    });

    const response = await model.invoke(messages);
    const latencyMs = Date.now() - startTime;
    const content =
      typeof response.content === "string" ? response.content : JSON.stringify(response.content);

    const usage = response.usage_metadata;
    const inputTokens = usage?.input_tokens ?? Math.ceil(state.question.length / 4);
    const outputTokens = usage?.output_tokens ?? Math.ceil(content.length / 4);

    // If the model itself reported insufficient information in the text
    const lowerContent = content.toLowerCase();
    const isInsufficient =
      lowerContent.includes("does not contain sufficient information") ||
      lowerContent.includes("not enough information in the provided") ||
      lowerContent.includes("cannot be answered based on the provided");

    if (isInsufficient) {
      return {
        answer: content,
        hasSufficientEvidence: false,
        insufficientEvidence: true,
        sources: [],
        confidence: "LOW",
        inputTokens,
        outputTokens,
        latencyMs,
      };
    }

    return {
      answer: content,
      inputTokens,
      outputTokens,
      latencyMs,
    };
  } catch (error: unknown) {
    const latencyMs = Date.now() - startTime;
    const errMessage = error instanceof Error ? error.message : String(error);
    logger.error({ err: errMessage, latencyMs }, "Document QA OpenAI invocation error");

    if (errMessage.includes("timeout") || errMessage.includes("ETIMEDOUT")) {
      throw new AppError("Document QA request timed out. Please try again.", 504, "PROVIDER_TIMEOUT");
    }
    if (errMessage.includes("429") || errMessage.includes("quota")) {
      throw new AppError(
        "AI provider rate limit or quota exceeded. Please try again shortly.",
        429,
        "PROVIDER_RATE_LIMIT"
      );
    }

    throw new AppError("AI provider error occurred while generating document answer", 502, "PROVIDER_ERROR");
  }
}

/**
 * Node 4: Validate Sources and Format Citations
 */
export async function validateSourcesNode(
  state: DocumentQAStateType
): Promise<Partial<DocumentQAStateType>> {
  if (!state.hasSufficientEvidence || state.insufficientEvidence) {
    return {
      sources: [],
      confidence: "LOW",
    };
  }

  // Format grounded citations from actual retrieved chunks
  const citations: DocumentCitationResponse[] = state.retrievedChunks
    .slice(0, 3)
    .map((chunk) => ({
      documentId: chunk.documentId,
      page: chunk.pageNumber,
      chunkId: chunk.id,
      excerpt:
        chunk.text.length > 200 ? `${chunk.text.substring(0, 197)}...` : chunk.text,
    }));

  const topSimilarity = state.retrievedChunks[0]?.similarity ?? 0;
  const confidence = isDocumentLevelQuery(state.question)
    ? "HIGH"
    : topSimilarity >= 0.65
    ? "HIGH"
    : "MEDIUM";

  return {
    sources: citations,
    confidence,
  };
}

/**
 * Builds the LangGraph workflow for document QA.
 */
export function buildDocumentQAGraph() {
  const workflow = new StateGraph(DocumentQAStateAnnotation)
    .addNode("retrieveChunks", retrieveChunksNode)
    .addNode("evaluateEvidence", evaluateEvidenceNode)
    .addNode("generateGroundedAnswer", generateGroundedAnswerNode)
    .addNode("validateSources", validateSourcesNode)
    .addEdge(START, "retrieveChunks")
    .addEdge("retrieveChunks", "evaluateEvidence")
    .addEdge("evaluateEvidence", "generateGroundedAnswer")
    .addEdge("generateGroundedAnswer", "validateSources")
    .addEdge("validateSources", END);

  return workflow.compile();
}

export const documentQAGraph = buildDocumentQAGraph();
