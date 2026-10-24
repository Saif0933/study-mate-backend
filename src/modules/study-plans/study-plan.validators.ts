import { z } from "zod";

export const planIdParamSchema = z.object({
  id: z.string().uuid({ message: "Invalid study plan ID format" }),
});

export const taskIdParamSchema = z.object({
  id: z.string().uuid({ message: "Invalid study task ID format" }),
});

export const createStudyPlanSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Title cannot be empty")
    .max(200, "Title must not exceed 200 characters"),
  examDate: z
    .string()
    .refine((val) => !isNaN(Date.parse(val)), { message: "Invalid exam date format" })
    .optional(),
  dailyMinutes: z.coerce
    .number()
    .int("Daily minutes must be an integer")
    .min(15, "Daily study time must be at least 15 minutes")
    .max(720, "Daily study time cannot exceed 720 minutes (12 hours)")
    .default(60),
  timezone: z.string().trim().default("Asia/Kolkata"),
  subjects: z
    .array(z.string().trim().min(1, "Subject name cannot be empty"))
    .min(1, "At least one subject is required")
    .max(20, "Cannot specify more than 20 subjects"),
  preferences: z.record(z.string(), z.unknown()).optional(),
});

export type CreateStudyPlanInput = z.infer<typeof createStudyPlanSchema>;

export const updateStudyPlanSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  status: z.enum(["ACTIVE", "COMPLETED", "ARCHIVED"]).optional(),
  preferences: z.record(z.string(), z.unknown()).optional(),
});

export type UpdateStudyPlanInput = z.infer<typeof updateStudyPlanSchema>;

export const regenerateStudyPlanSchema = z.object({
  preserveCompleted: z.boolean().default(true),
  dailyMinutes: z.coerce.number().int().min(15).max(720).optional(),
  examDate: z
    .string()
    .refine((val) => !isNaN(Date.parse(val)), { message: "Invalid exam date format" })
    .optional(),
});

export type RegenerateStudyPlanInput = z.infer<typeof regenerateStudyPlanSchema>;

export const updateStudyTaskSchema = z.object({
  status: z.enum(["TODO", "IN_PROGRESS", "COMPLETED", "SKIPPED"]).optional(),
  completedAt: z.string().nullable().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  topic: z.string().trim().max(200).optional(),
  description: z.string().trim().optional(),
  durationMinutes: z.coerce.number().int().min(5).max(720).optional(),
  scheduledDate: z
    .string()
    .refine((val) => !isNaN(Date.parse(val)), { message: "Invalid scheduled date format" })
    .optional(),
});

export type UpdateStudyTaskInput = z.infer<typeof updateStudyTaskSchema>;

export const createStudyTaskSchema = z.object({
  title: z.string().trim().min(1, "Task title is required").max(200),
  topic: z.string().trim().max(200).optional(),
  description: z.string().trim().optional(),
  scheduledDate: z
    .string()
    .refine((val) => !isNaN(Date.parse(val)), { message: "Invalid scheduled date format" }),
  durationMinutes: z.coerce
    .number()
    .int()
    .min(5, "Task duration must be at least 5 minutes")
    .max(720, "Task duration cannot exceed 720 minutes")
    .default(30),
});

export type CreateStudyTaskInput = z.infer<typeof createStudyTaskSchema>;
