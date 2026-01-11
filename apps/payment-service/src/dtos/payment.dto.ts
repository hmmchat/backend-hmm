import { z } from "zod";

// Purchase Initiation Schema
export const InitiatePurchaseSchema = z.object({
  coinsAmount: z.number().int().positive().min(1, "Coins amount must be at least 1")
});

// Payment Verification Schema
export const VerifyPaymentSchema = z.object({
  paymentId: z.string().min(1, "Payment ID is required"),
  orderId: z.string().min(1, "Order ID is required"),
  signature: z.string().min(1, "Signature is required")
});

// Redemption Preview Schema
export const PreviewRedemptionSchema = z.object({
  baseDiamonds: z.number().int().positive().min(1, "Diamonds amount must be at least 1")
});

// Redemption Initiation Schema
export const InitiateRedemptionSchema = z.object({
  baseDiamonds: z.number().int().positive().min(1, "Diamonds amount must be at least 1"),
  upsellLevel: z.number().int().min(0).max(3, "Upsell level must be between 0 and 3"),
  bankAccountDetails: z.object({
    accountNumber: z.string().min(9).max(18, "Invalid account number"),
    ifsc: z.string().length(11, "IFSC must be 11 characters").regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Invalid IFSC format"),
    name: z.string().min(2).max(100, "Account name must be between 2 and 100 characters"),
    accountType: z.enum(["savings", "current"]).optional()
  })
});

// History Query Schema
export const HistoryQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(100)).optional().default("50")
});

// Webhook payload (Razorpay sends various event types)
export const RazorpayWebhookSchema = z.object({
  event: z.string(),
  payload: z.object({
    payment: z.object({
      entity: z.object({
        id: z.string(),
        amount: z.number(),
        currency: z.string(),
        status: z.string(),
        order_id: z.string().optional(),
        method: z.string().optional()
      }).optional()
    }).optional(),
    payout: z.object({
      entity: z.object({
        id: z.string(),
        amount: z.number(),
        currency: z.string(),
        status: z.string(),
        fund_account_id: z.string().optional(),
        mode: z.string().optional()
      }).optional()
    }).optional(),
    order: z.object({
      entity: z.object({
        id: z.string(),
        amount: z.number(),
        currency: z.string(),
        status: z.string()
      }).optional()
    }).optional()
  }).passthrough() // Allow additional fields in payload
});

// Type exports
export type InitiatePurchaseDto = z.infer<typeof InitiatePurchaseSchema>;
export type VerifyPaymentDto = z.infer<typeof VerifyPaymentSchema>;
export type PreviewRedemptionDto = z.infer<typeof PreviewRedemptionSchema>;
export type InitiateRedemptionDto = z.infer<typeof InitiateRedemptionSchema>;
export type HistoryQueryDto = z.infer<typeof HistoryQuerySchema>;
export type RazorpayWebhookDto = z.infer<typeof RazorpayWebhookSchema>;
