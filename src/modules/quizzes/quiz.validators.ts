import { z } from "zod";

export const quizIdParamSchema = z.object({
  id: z.string().uuid({ message: "Invalid quiz ID format" }),
});

export const attemptIdParamSchema = z.object({
  id: z.string().uuid({ message: "Invalid attempt ID format" }),
});

export const createQuizSchema = z
  .object({
    title: z.string().trim().max(200, "Title must not exceed 200 characters").optional(),
    topic: z.string().trim().max(200, "Topic must not exceed 200 characters").optional(),
    sourceDocumentId: z.string().uuid("Invalid source document ID").optional(),
    difficulty: z.enum(["EASY", "MEDIUM", "HARD"]).default("MEDIUM"),
    questionCount: z.coerce
      .number()
      .int("Question count must be an integer")
      .min(1, "Question count must be at least 1")
      .max(20, "Question count cannot exceed 20")
      .default(5),
  })
  .refine(
    (data) => {
      const hasTopic = Boolean(data.topic && data.topic.trim().length > 0);
      const hasDoc = Boolean(data.sourceDocumentId && data.sourceDocumentId.trim().length > 0);
      return hasTopic || hasDoc;
    },
    {
      message: "Either topic or sourceDocumentId must be provided to generate a quiz",
      path: ["topic"],
    }
  );

export type CreateQuizInput = z.infer<typeof createQuizSchema>;

export const submitAttemptSchema = z.object({
  responses: z
    .array(
      z.object({
        questionId: z.string().uuid({ message: "Invalid question ID format" }),
        selectedAnswer: z.string().trim().nullable().optional(),
      })
    )
    .min(0),
});

export type SubmitAttemptInput = z.infer<typeof submitAttemptSchema>;
