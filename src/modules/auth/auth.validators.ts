import { z } from "zod";

export const registerSchema = z.object({
  email: z
    .string()
    .trim()
    .email({ message: "A valid email address is required" })
    .transform((e) => e.toLowerCase()),
  password: z
    .string()
    .min(8, { message: "Password must be at least 8 characters long" })
    .max(128, { message: "Password cannot exceed 128 characters" }),
  displayName: z
    .string()
    .trim()
    .max(100, { message: "Display name cannot exceed 100 characters" })
    .optional(),
});

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .email({ message: "A valid email address is required" })
    .transform((e) => e.toLowerCase()),
  password: z.string().min(1, { message: "Password is required" }),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, { message: "Refresh token is required" }),
});

export const forgotPasswordSchema = z.object({
  email: z
    .string()
    .trim()
    .email({ message: "A valid email address is required" })
    .transform((e) => e.toLowerCase()),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, { message: "Password reset token is required" }),
  password: z
    .string()
    .min(8, { message: "Password must be at least 8 characters long" })
    .max(128, { message: "Password cannot exceed 128 characters" }),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
