import { z } from "zod";

export const createConversationSchema = z.object({
  title: z
    .string()
    .trim()
    .max(200, { message: "Title cannot exceed 200 characters" })
    .optional(),
});

export const sendMessageSchema = z
  .object({
    content: z
      .string()
      .trim()
      .max(8000, { message: "Message content cannot exceed 8000 characters" })
      .default(""),
    explanationMode: z
      .enum(["simple", "detailed", "examples"])
      .optional(),
    imageBase64: z
      .string()
      .optional(),
  })
  .refine(
    (data) => data.content.length > 0 || (data.imageBase64 && data.imageBase64.length > 0),
    {
      message: "Message content cannot be empty",
      path: ["content"],
    }
  );

export const renameConversationSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, { message: "Title cannot be empty" })
    .max(200, { message: "Title cannot exceed 200 characters" }),
});

export const conversationIdParamSchema = z.object({
  id: z.string().uuid({ message: "Invalid conversation ID format" }),
});

export type CreateConversationInput = z.infer<typeof createConversationSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type RenameConversationInput = z.infer<typeof renameConversationSchema>;
