import { z } from "zod";

// Request DTOs
export const GetCardQuerySchema = z.object({
  sessionId: z.string().min(1, "Session ID is required"),
  soloOnly: z.string().optional().transform((val) => val === "true" || val === "1")
});

export const RaincheckRequestSchema = z.object({
  sessionId: z.string().min(1, "Session ID is required"),
  raincheckedUserId: z.string().min(1, "Rainchecked user ID is required")
});

export const ResetSessionRequestSchema = z.object({
  sessionId: z.string().min(1, "Session ID is required")
});

// Type exports
export type GetCardQuery = z.infer<typeof GetCardQuerySchema>;
export type RaincheckRequest = z.infer<typeof RaincheckRequestSchema>;
export type ResetSessionRequest = z.infer<typeof ResetSessionRequestSchema>;

