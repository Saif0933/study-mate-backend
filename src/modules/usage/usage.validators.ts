import { z } from "zod";

export const submitFeedbackSchema = z.object({
  rating: z.string().trim().min(1, "Rating is required").max(50),
  category: z.string().trim().max(100).optional(),
  comment: z.string().trim().min(1, "Comment cannot be empty").max(2000),
  messageId: z.string().uuid("Invalid message ID format").optional(),
});

export type SubmitFeedbackInput = z.infer<typeof submitFeedbackSchema>;

export const updateProfileSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, "Display name cannot be empty")
    .max(100, "Display name cannot exceed 100 characters"),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
