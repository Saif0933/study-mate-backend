import { prisma, getDbPool } from "../../config/prisma";
import { Document } from "../../generated/prisma/client";
import { DocumentStatus, AIRequestFeature, AIRequestStatus } from "../../generated/prisma/enums";
import { calculateEstimatedCost } from "../../utils/cost-calculator";

export interface CreateDocumentData {
  id?: string;
  userId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: bigint;
  storageKey: string;
  checksum?: string;
  status?: DocumentStatus;
}

export interface ChunkInsertData {
  id: string;
  documentId: string;
  userId: string;
  chunkIndex: number;
  pageNumber: number | null;
  text: string;
  embedding: number[];
  embeddingModel: string;
}

export interface RecordUsageData {
  userId: string;
  requestId: string;
  modelId: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  status: AIRequestStatus;
  errorCode?: string;
}

export class DocumentRepository {
  /**
   * Creates a new Document record in PostgreSQL.
   */
  async createDocument(data: CreateDocumentData): Promise<Document> {
    return prisma.document.create({
      data: {
        id: data.id,
        userId: data.userId,
        originalName: data.originalName,
        mimeType: data.mimeType,
        sizeBytes: data.sizeBytes,
        storageKey: data.storageKey,
        checksum: data.checksum,
        status: data.status || DocumentStatus.UPLOADED,
      },
    });
  }

  /**
   * Find document by primary key id.
   */
  async findById(id: string): Promise<Document | null> {
    return prisma.document.findUnique({
      where: { id },
    });
  }

  /**
   * Find all active (non-deleted) documents for a user, ordered by creation date descending.
   */
  async findByUserId(userId: string): Promise<Document[]> {
    return prisma.document.findMany({
      where: {
        userId,
        status: {
          not: DocumentStatus.DELETED,
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  /**
   * Updates document status and associated extraction metadata.
   */
  async updateStatus(
    id: string,
    status: DocumentStatus,
    metadata?: {
      pageCount?: number | null;
      errorCode?: string | null;
      processedAt?: Date | null;
    }
  ): Promise<Document> {
    return prisma.document.update({
      where: { id },
      data: {
        status,
        ...(metadata?.pageCount !== undefined && { pageCount: metadata.pageCount }),
        ...(metadata?.errorCode !== undefined && { errorCode: metadata.errorCode }),
        ...(metadata?.processedAt !== undefined && { processedAt: metadata.processedAt }),
      },
    });
  }

  /**
   * Idempotently saves document chunks with pgvector embeddings inside a database transaction.
   * Purges previous chunks for this document before inserting fresh chunks.
   */
  async saveChunks(documentId: string, chunks: ChunkInsertData[]): Promise<void> {
    const pool = getDbPool();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Idempotency: delete any existing chunks for this document
      await client.query('DELETE FROM "DocumentChunk" WHERE "documentId" = $1::uuid', [documentId]);

      const insertSql = `
        INSERT INTO "DocumentChunk" (
          id, "documentId", "userId", "chunkIndex", "pageNumber", text, embedding, "embeddingModel", "createdAt"
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::vector, $8, NOW()
        );
      `;

      for (const chunk of chunks) {
        const vectorString = `[${chunk.embedding.join(",")}]`;
        await client.query(insertSql, [
          chunk.id,
          chunk.documentId,
          chunk.userId,
          chunk.chunkIndex,
          chunk.pageNumber,
          chunk.text,
          vectorString,
          chunk.embeddingModel,
        ]);
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Deletes a document and its chunks completely from the database.
   */
  async deleteDocument(id: string): Promise<void> {
    const pool = getDbPool();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await client.query('DELETE FROM "DocumentChunk" WHERE "documentId" = $1::uuid', [id]);
      await client.query('DELETE FROM "Document" WHERE id = $1::uuid', [id]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Retrieves chunk count for a document.
   */
  async getChunkCount(documentId: string): Promise<number> {
    return prisma.documentChunk.count({
      where: { documentId },
    });
  }

  /**
   * Records AI Usage entry for Document QA requests.
   */
  async recordUsage(data: RecordUsageData): Promise<void> {
    await prisma.aIUsage.create({
      data: {
        userId: data.userId,
        requestId: data.requestId,
        feature: AIRequestFeature.DOCUMENT_QA,
        provider: "openai",
        modelId: data.modelId,
        status: data.status,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        latencyMs: data.latencyMs,
        estimatedCost: calculateEstimatedCost(data.modelId, data.inputTokens, data.outputTokens),
        errorCode: data.errorCode,
      },
    });
  }
}

export const documentRepository = new DocumentRepository();
