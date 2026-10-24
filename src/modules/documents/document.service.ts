import { v4 as uuidv4 } from "uuid";
import { Document } from "../../generated/prisma/client";
import { DocumentStatus, AIRequestStatus } from "../../generated/prisma/enums";
import { documentRepository, DocumentRepository } from "./document.repository";
import { fileStorageService, FileStorageService, validatePdfSignature } from "../../utils/file-storage";
import { parsePdfDocument } from "../../utils/pdf-parser";
import { defaultTextSplitter, RecursiveTextSplitter } from "../../utils/text-splitter";
import { documentRetriever, DocumentRetriever } from "../../ai/retrievers/document.retriever";
import { documentQAGraph } from "../../ai/graphs/document-qa.graph";
import { getEnv } from "../../config/env";
import { logger } from "../../utils/logger";
import { BadRequestError, NotFoundError } from "../../utils/errors";
import { DocumentResponse, DocumentQAResult } from "../../types/document";
import { AskQuestionInput } from "./document.validators";
import { usageService } from "../usage/usage.service";

export class DocumentService {
  constructor(
    private readonly repo: DocumentRepository = documentRepository,
    private readonly storage: FileStorageService = fileStorageService,
    private readonly splitter: RecursiveTextSplitter = defaultTextSplitter,
    private readonly retriever: DocumentRetriever = documentRetriever
  ) {}

  /**
   * Serializes a Prisma Document into the client-facing DocumentResponse format.
   * Crucially converts BigInt sizeBytes into number for valid JSON serialization.
   */
  sanitizeDocument(doc: Document): DocumentResponse {
    return {
      id: doc.id,
      originalName: doc.originalName,
      mimeType: doc.mimeType,
      sizeBytes: Number(doc.sizeBytes),
      status: doc.status,
      pageCount: doc.pageCount,
      errorCode: doc.errorCode,
      createdAt: doc.createdAt.toISOString(),
      processedAt: doc.processedAt ? doc.processedAt.toISOString() : null,
    };
  }

  /**
   * Uploads and processes a PDF file.
   * Performs validation, saves to private storage, extracts text, generates embeddings,
   * and saves chunks idempotently with appropriate status transitions.
   */
  async uploadAndProcess(userId: string, file?: Express.Multer.File): Promise<DocumentResponse> {
    if (!file || !file.buffer) {
      throw new BadRequestError("File is required. Please upload a PDF document.");
    }

    const env = getEnv();

    // 1. Validate MIME type
    if (file.mimetype !== "application/pdf") {
      throw new BadRequestError("Unsupported file type: only PDF documents are accepted.");
    }

    // 2. Validate file size
    if (file.size > env.MAX_FILE_SIZE_BYTES) {
      const maxMb = Math.round(env.MAX_FILE_SIZE_BYTES / (1024 * 1024));
      throw new BadRequestError(`File size exceeds the allowed limit of ${maxMb}MB.`);
    }

    // 3. Validate magic bytes / PDF signature
    if (!validatePdfSignature(file.buffer)) {
      throw new BadRequestError("Invalid file signature: uploaded file is not a valid PDF document.");
    }

    const documentId = uuidv4();
    const originalName = file.originalname || "document.pdf";

    // 4. Save file to private storage
    const { storageKey, checksum, sizeBytes } = await this.storage.saveDocumentFile(
      userId,
      documentId,
      file.buffer
    );

    // 5. Create initial document record with status UPLOADED
    let doc = await this.repo.createDocument({
      id: documentId,
      userId,
      originalName,
      mimeType: file.mimetype,
      sizeBytes: BigInt(sizeBytes),
      storageKey,
      checksum,
      status: DocumentStatus.UPLOADED,
    });

    try {
      // 6. Transition to PROCESSING
      doc = await this.repo.updateStatus(documentId, DocumentStatus.PROCESSING);

      // 7. Extract text and page metadata
      const parseResult = await parsePdfDocument(file.buffer);

      if (!parseResult.success) {
        logger.warn(
          { documentId, userId, errorCode: parseResult.errorCode },
          "Document parsing failed"
        );
        doc = await this.repo.updateStatus(documentId, DocumentStatus.FAILED, {
          errorCode: parseResult.errorCode,
        });
        return this.sanitizeDocument(doc);
      }

      // 8. Split text into chunks
      const chunkDrafts = this.splitter.splitPages(parseResult.pages);

      if (chunkDrafts.length === 0) {
        doc = await this.repo.updateStatus(documentId, DocumentStatus.FAILED, {
          errorCode: "SCANNED_OR_EMPTY_PDF",
        });
        return this.sanitizeDocument(doc);
      }

      // 9. Generate embeddings for all chunks
      const texts = chunkDrafts.map((c) => c.text);
      const embeddings = await this.retriever.generateEmbeddings(texts);

      // 10. Prepare chunks for idempotent transaction insert
      const chunksToInsert = chunkDrafts.map((draft, idx) => ({
        id: uuidv4(),
        documentId,
        userId,
        chunkIndex: draft.chunkIndex,
        pageNumber: draft.pageNumber,
        text: draft.text,
        embedding: embeddings[idx]!,
        embeddingModel: env.OPENAI_EMBEDDING_MODEL,
      }));

      await this.repo.saveChunks(documentId, chunksToInsert);

      // 11. Transition to READY
      doc = await this.repo.updateStatus(documentId, DocumentStatus.READY, {
        pageCount: parseResult.pageCount,
        processedAt: new Date(),
      });

      logger.info(
        { documentId, userId, chunksCount: chunksToInsert.length, pageCount: parseResult.pageCount },
        "Document successfully processed and ready"
      );

      return this.sanitizeDocument(doc);
    } catch (processError) {
      const err = processError as Error;
      logger.error({ err: err.message, documentId, userId }, "Unexpected error during document processing");
      doc = await this.repo.updateStatus(documentId, DocumentStatus.FAILED, {
        errorCode: "CORRUPTED_PDF",
      });
      return this.sanitizeDocument(doc);
    }
  }

  /**
   * Lists non-deleted documents for the authenticated user.
   */
  async getDocuments(userId: string): Promise<DocumentResponse[]> {
    const docs = await this.repo.findByUserId(userId);
    return docs.map((d) => this.sanitizeDocument(d));
  }

  /**
   * Retrieves single document by ID, enforcing authenticated user ownership.
   */
  async getDocumentById(userId: string, documentId: string): Promise<DocumentResponse> {
    const doc = await this.repo.findById(documentId);
    if (!doc || doc.userId !== userId || doc.status === DocumentStatus.DELETED) {
      throw new NotFoundError("Document not found");
    }
    return this.sanitizeDocument(doc);
  }

  /**
   * Grounded question answering on a READY document via LangGraph workflow.
   */
  async askQuestion(
    userId: string,
    documentId: string,
    input: AskQuestionInput,
    requestId: string
  ): Promise<DocumentQAResult> {
    const doc = await this.repo.findById(documentId);
    if (!doc || doc.userId !== userId || doc.status === DocumentStatus.DELETED) {
      throw new NotFoundError("Document not found");
    }

    if (doc.status === DocumentStatus.UPLOADED || doc.status === DocumentStatus.PROCESSING) {
      throw new BadRequestError("Document is still being processed. Please wait until it is ready.");
    }

    if (doc.status === DocumentStatus.FAILED) {
      throw new BadRequestError(`Document processing failed: ${doc.errorCode || "unsupported format"}`);
    }

    if (doc.status !== DocumentStatus.READY) {
      throw new BadRequestError("Document is not available for questions.");
    }

    // Check AI quota before initiating document Q&A
    await usageService.checkQuota(userId);

    const result = await documentQAGraph.invoke({
      userId,
      documentId,
      question: input.question,
    });

    // Record AI Usage asynchronously
    try {
      await this.repo.recordUsage({
        userId,
        requestId,
        modelId: result.modelId || "gpt-4o",
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: result.latencyMs,
        status: AIRequestStatus.SUCCESS,
      });
    } catch (usageErr) {
      logger.warn({ err: (usageErr as Error).message }, "Failed to record AI usage for document QA");
    }

    return {
      answer: result.answer,
      sources: result.sources || [],
      hasSufficientEvidence: result.hasSufficientEvidence,
      insufficientEvidence: result.insufficientEvidence,
      confidence: result.confidence,
    };
  }

  /**
   * Deletes a document, unlinks original storage file, and purges all chunks and embeddings.
   */
  async deleteDocument(userId: string, documentId: string): Promise<void> {
    const doc = await this.repo.findById(documentId);
    if (!doc || doc.userId !== userId || doc.status === DocumentStatus.DELETED) {
      throw new NotFoundError("Document not found");
    }

    // Set DELETING status for immediate access revocation
    await this.repo.updateStatus(documentId, DocumentStatus.DELETING);

    // Remove private file from disk
    await this.storage.deleteDocumentFile(doc.storageKey);

    // Delete document and all chunks from database
    await this.repo.deleteDocument(documentId);

    logger.info({ documentId, userId }, "Document and derived embeddings successfully deleted");
  }
}

export const documentService = new DocumentService();
