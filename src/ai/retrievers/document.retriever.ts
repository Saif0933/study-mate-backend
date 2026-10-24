import { OpenAIEmbeddings } from "@langchain/openai";
import { shouldUseLiveAi } from "../model-factory";
import { getEnv } from "../../config/env";
import { getDbPool } from "../../config/prisma";
import { logger } from "../../utils/logger";
import { RetrievedChunk } from "../../types/document";

function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return hash;
}

const STOP_WORDS = new Set([
  "a", "about", "all", "an", "and", "any", "are", "as", "at", "be", "because", "been", "before",
  "being", "but", "by", "can", "could", "did", "do", "does", "each", "for", "from", "had", "has",
  "have", "he", "her", "here", "him", "his", "how", "i", "if", "in", "into", "is", "it", "its",
  "me", "more", "most", "my", "no", "nor", "not", "of", "on", "or", "our", "out", "over", "she",
  "so", "some", "such", "than", "that", "the", "their", "them", "then", "there", "these", "they",
  "this", "those", "through", "to", "too", "under", "up", "very", "was", "we", "were", "what",
  "when", "where", "which", "while", "who", "whom", "why", "with", "would", "you", "your"
]);

/**
 * Deterministic normalized vector generator using Feature Hashing.
 * Produces unit vectors in 1536-dimensional space for offline & testing workflows.
 */
export function generateDeterministicEmbedding(text: string, dimension = 1536): number[] {
  const vector = new Array(dimension).fill(0);
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  const rawTokens = normalized.split(/\s+/).filter((t) => t.length > 0);
  const tokens = rawTokens.filter((t) => !STOP_WORDS.has(t));
  const effectiveTokens = tokens.length > 0 ? tokens : rawTokens;

  if (effectiveTokens.length === 0) {
    const val = 1 / Math.sqrt(dimension);
    return new Array(dimension).fill(val);
  }

  for (let i = 0; i < effectiveTokens.length; i++) {
    const token = effectiveTokens[i]!;
    const h1 = Math.abs(hashString(token));
    const idx1 = h1 % dimension;
    vector[idx1] += 1.0;

    if (i < effectiveTokens.length - 1) {
      const bigram = `${token}_${effectiveTokens[i + 1]}`;
      const h2 = Math.abs(hashString(bigram));
      const idx2 = h2 % dimension;
      vector[idx2] += 1.5;
    }
  }

  let sumSq = 0;
  for (let i = 0; i < dimension; i++) {
    sumSq += vector[i] * vector[i];
  }
  const norm = Math.sqrt(sumSq) || 1;
  for (let i = 0; i < dimension; i++) {
    vector[i] = vector[i] / norm;
  }

  return vector;
}

export class DocumentRetriever {
  /**
   * Generates embedding vector for a given text string.
   * Asserts the vector dimension matches the configured database schema (1536).
   */
  async generateEmbedding(text: string): Promise<number[]> {
    const env = getEnv();
    const expectedDim = env.EMBEDDING_DIMENSION || 1536;

    let vector: number[];

    if (!shouldUseLiveAi()) {
      vector = generateDeterministicEmbedding(text, expectedDim);
    } else {
      try {
        const embeddings = new OpenAIEmbeddings({
          openAIApiKey: env.OPENAI_API_KEY,
          modelName: env.OPENAI_EMBEDDING_MODEL,
          dimensions: expectedDim,
        });
        vector = await embeddings.embedQuery(text);
      } catch (err: unknown) {
        logger.warn({ err: (err as Error).message }, "OpenAI embedding generation failed, falling back to deterministic embedding");
        vector = generateDeterministicEmbedding(text, expectedDim);
      }
    }

    if (vector.length !== expectedDim) {
      throw new Error(`Embedding vector dimension mismatch: expected ${expectedDim}, got ${vector.length}`);
    }

    return vector;
  }

  /**
   * Batch generates embedding vectors for multiple texts.
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      const vec = await this.generateEmbedding(text);
      results.push(vec);
    }
    return results;
  }

  /**
   * Performs semantic retrieval filtered by authenticated user and selected document.
   * Uses pgvector cosine similarity operator (<=>) with parameterized query.
   */
  async retrieveChunks(
    userId: string,
    documentId: string,
    queryEmbedding: number[],
    limit = 4
  ): Promise<RetrievedChunk[]> {
    const pool = getDbPool();
    const vectorString = `[${queryEmbedding.join(",")}]`;

    const query = `
      SELECT 
        id, 
        "documentId", 
        "userId", 
        "chunkIndex", 
        "pageNumber", 
        text, 
        1 - (embedding <=> $1::vector) AS similarity 
      FROM "DocumentChunk" 
      WHERE "userId" = $2::uuid AND "documentId" = $3::uuid 
      ORDER BY embedding <=> $1::vector 
      LIMIT $4;
    `;

    const result = await pool.query(query, [vectorString, userId, documentId, limit]);

    return result.rows.map((row) => ({
      id: row.id,
      documentId: row.documentId,
      userId: row.userId,
      chunkIndex: row.chunkIndex,
      pageNumber: row.pageNumber,
      text: row.text,
      similarity: parseFloat(row.similarity),
    }));
  }

  /**
   * Retrieves chronological document chunks for synthesis, overview, and broad generative queries.
   */
  async getDocumentChunks(
    userId: string,
    documentId: string,
    limit = 8
  ): Promise<RetrievedChunk[]> {
    const pool = getDbPool();
    const query = `
      SELECT 
        id, 
        "documentId", 
        "userId", 
        "chunkIndex", 
        "pageNumber", 
        text, 
        0.5 AS similarity 
      FROM "DocumentChunk" 
      WHERE "userId" = $1::uuid AND "documentId" = $2::uuid 
      ORDER BY "chunkIndex" ASC 
      LIMIT $3;
    `;
    const result = await pool.query(query, [userId, documentId, limit]);
    return result.rows.map((row) => ({
      id: row.id,
      documentId: row.documentId,
      userId: row.userId,
      chunkIndex: row.chunkIndex,
      pageNumber: row.pageNumber,
      text: row.text,
      similarity: parseFloat(row.similarity),
    }));
    
  }
}

export const documentRetriever = new DocumentRetriever();
