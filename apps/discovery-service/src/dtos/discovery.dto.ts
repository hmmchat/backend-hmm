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

export const SelectLocationRequestSchema = z.object({
  sessionId: z.string().min(1, "Session ID is required"),
  city: z.string().nullable() // null means "Anywhere"
});

export const ProceedRequestSchema = z.object({
  matchedUserId: z.string().min(1, "Matched user ID is required")
});

// Type exports
export type GetCardQuery = z.infer<typeof GetCardQuerySchema>;
export type RaincheckRequest = z.infer<typeof RaincheckRequestSchema>;
export type ResetSessionRequest = z.infer<typeof ResetSessionRequestSchema>;
export type SelectLocationRequest = z.infer<typeof SelectLocationRequestSchema>;
export type ProceedRequest = z.infer<typeof ProceedRequestSchema>;

// Squad DTOs
export const InviteFriendRequestSchema = z.object({
  inviteeId: z.string().min(1, "Invitee ID is required")
});

export const InviteExternalRequestSchema = z.object({
  // No fields needed - token will be generated
});

export const AcceptInvitationRequestSchema = z.object({
  inviteId: z.string().min(1, "Invitation ID is required")
});

export const RejectInvitationRequestSchema = z.object({
  inviteId: z.string().min(1, "Invitation ID is required")
});

export const ToggleSoloRequestSchema = z.object({
  // No fields needed
});

export const EnterCallRequestSchema = z.object({
  // No fields needed - uses inviter from token
});

export type InviteFriendRequest = z.infer<typeof InviteFriendRequestSchema>;
export type InviteExternalRequest = z.infer<typeof InviteExternalRequestSchema>;
export type AcceptInvitationRequest = z.infer<typeof AcceptInvitationRequestSchema>;
export type RejectInvitationRequest = z.infer<typeof RejectInvitationRequestSchema>;
export type ToggleSoloRequest = z.infer<typeof ToggleSoloRequestSchema>;
export type EnterCallRequest = z.infer<typeof EnterCallRequestSchema>;

// Internal Service DTOs (for service-to-service communication)
export const RoomCreatedRequestSchema = z.object({
  roomId: z.string().min(1, "Room ID is required"),
  userIds: z.array(z.string().min(1)).min(1, "At least one user ID is required")
});

export const BroadcastStartedRequestSchema = z.object({
  roomId: z.string().min(1, "Room ID is required"),
  userIds: z.array(z.string().min(1)).min(1, "At least one user ID is required")
});

export const CallEndedRequestSchema = z.object({
  roomId: z.string().min(1, "Room ID is required"),
  userIds: z.array(z.string().min(1)).min(1, "At least one user ID is required")
});

export type RoomCreatedRequest = z.infer<typeof RoomCreatedRequestSchema>;
export type BroadcastStartedRequest = z.infer<typeof BroadcastStartedRequestSchema>;
export type CallEndedRequest = z.infer<typeof CallEndedRequestSchema>;

// OFFLINE Cards DTOs
export const GetOfflineCardQuerySchema = z.object({
  sessionId: z.string().min(1, "Session ID is required"),
  soloOnly: z.string().optional().transform((val) => val === "true" || val === "1")
});

export const OfflineRaincheckRequestSchema = z.object({
  sessionId: z.string().min(1, "Session ID is required"),
  raincheckedUserId: z.string().min(1, "Rainchecked user ID is required")
});

export const SendFriendRequestFromOfflineCardSchema = z.object({
  toUserId: z.string().min(1, "To user ID is required")
});

export const SendGiftFromOfflineCardSchema = z.object({
  toUserId: z.string().min(1, "To user ID is required"),
  amount: z.number().positive("Amount must be positive"),
  giftId: z.string().min(1, "Gift ID is required")
});

export type GetOfflineCardQuery = z.infer<typeof GetOfflineCardQuerySchema>;
export type OfflineRaincheckRequest = z.infer<typeof OfflineRaincheckRequestSchema>;
export type SendFriendRequestFromOfflineCard = z.infer<typeof SendFriendRequestFromOfflineCardSchema>;
export type SendGiftFromOfflineCard = z.infer<typeof SendGiftFromOfflineCardSchema>;
