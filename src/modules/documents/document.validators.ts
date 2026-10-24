import { z } from "zod";

export const documentIdParamSchema = z.object({
  id: z.string().uuid({ message: "Invalid document ID format" }),
});

export const askQuestionSchema = z.object({
  question: z
    .string()
    .trim()
    .min(1, { message: "Question cannot be empty" })
    .max(2000, { message: "Question exceeds maximum length of 2000 characters" }),
});

export type AskQuestionInput = z.infer<typeof askQuestionSchema>;
