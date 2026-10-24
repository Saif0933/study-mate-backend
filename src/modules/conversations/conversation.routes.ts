import { Router } from "express";
import { conversationController } from "./conversation.controller";
import { authenticate } from "../../middleware/authenticate";
import { messageRateLimiter } from "../../middleware/rate-limit";

export const conversationRouter = Router();

// All conversation operations require authenticated active user
conversationRouter.use(authenticate);

conversationRouter.post("/", conversationController.createConversation);
conversationRouter.get("/", conversationController.getConversations);
conversationRouter.get("/:id", conversationController.getConversation);
conversationRouter.get("/:id/messages", conversationController.getMessages);
conversationRouter.post("/:id/messages", messageRateLimiter, conversationController.sendMessage);
conversationRouter.patch("/:id", conversationController.renameConversation);
conversationRouter.delete("/:id", conversationController.deleteConversation);
