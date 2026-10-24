import { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { documentService, DocumentService } from "./document.service";
import { documentIdParamSchema, askQuestionSchema } from "./document.validators";

export class DocumentController {
  constructor(private readonly service: DocumentService = documentService) {}

  /**
   * POST /api/v1/documents
   * Multipart upload of PDF document with immediate/asynchronous processing.
   */
  uploadDocument = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const result = await this.service.uploadAndProcess(req.user!.id, req.file);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/v1/documents
   * List non-deleted documents uploaded by the authenticated user.
   */
  getDocuments = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const result = await this.service.getDocuments(req.user!.id);
      res.status(200).json({ documents: result });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/v1/documents/:id
   * Get metadata and processing state of a specific document.
   */
  getDocument = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { id } = documentIdParamSchema.parse(req.params);
      const result = await this.service.getDocumentById(req.user!.id, id);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/v1/documents/:id/questions
   * Ask a grounded question against a processed document via LangGraph RAG workflow.
   */
  askQuestion = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { id } = documentIdParamSchema.parse(req.params);
      const validated = askQuestionSchema.parse(req.body);
      const requestId = req.id ? String(req.id) : uuidv4();

      const result = await this.service.askQuestion(
        req.user!.id,
        id,
        validated,
        requestId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * DELETE /api/v1/documents/:id
   * Cascading deletion of document, private storage file, chunks, and embeddings.
   */
  deleteDocument = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { id } = documentIdParamSchema.parse(req.params);
      await this.service.deleteDocument(req.user!.id, id);
      res.status(200).json({ message: "Document deleted successfully" });
    } catch (error) {
      next(error);
    }
  };
}

export const documentController = new DocumentController();
