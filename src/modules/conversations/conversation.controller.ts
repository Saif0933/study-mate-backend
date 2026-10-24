import { Request, Response, NextFunction } from "express";
import { conversationService, ConversationService } from "./conversation.service";
import {
  createConversationSchema,
  sendMessageSchema,
  renameConversationSchema,
  conversationIdParamSchema,
} from "./conversation.validators";
import { v4 as uuidv4 } from "uuid";

export class ConversationController {
  constructor(private readonly service: ConversationService = conversationService) {}

  createConversation = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const validated = createConversationSchema.parse(req.body);
      const result = await this.service.createConversation(req.user!.id, validated);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  };

  getConversations = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const result = await this.service.getConversations(req.user!.id);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  getConversation = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { id } = conversationIdParamSchema.parse(req.params);
      const result = await this.service.getConversation(req.user!.id, id);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  getMessages = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { id } = conversationIdParamSchema.parse(req.params);
      const result = await this.service.getMessages(req.user!.id, id);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  sendMessage = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { id } = conversationIdParamSchema.parse(req.params);
      const validated = sendMessageSchema.parse(req.body);
      const requestId = req.id ? String(req.id) : uuidv4();

      const result = await this.service.sendMessage(
        req.user!.id,
        id,
        validated,
        requestId
      );
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  };

  renameConversation = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { id } = conversationIdParamSchema.parse(req.params);
      const validated = renameConversationSchema.parse(req.body);
      const result = await this.service.renameConversation(
        req.user!.id,
        id,
        validated
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  deleteConversation = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { id } = conversationIdParamSchema.parse(req.params);
      const result = await this.service.deleteConversation(req.user!.id, id);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}

export const conversationController = new ConversationController();
