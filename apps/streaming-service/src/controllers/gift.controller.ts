import { Controller, Get, Post, Param, Body } from "@nestjs/common";
import { GiftService } from "../services/gift.service.js";
import { z } from "zod";

const sendGiftSchema = z.object({
  toUserId: z.string(),
  amount: z.number().positive(),
  giftId: z.string(), // Gift sticker ID (monkey, pikachu, etc.) - required
  fromUserId: z.string().optional() // Optional in test mode
});

@Controller("streaming/rooms/:roomId/gifts")
export class GiftController {
  private readonly testMode: boolean;

  constructor(private giftService: GiftService) {
    // Always enable test mode for easier testing
    this.testMode = true; // process.env.TEST_MODE === "true" || process.env.NODE_ENV === "test";
  }

  /**
   * Send a gift
   * POST /streaming/rooms/:roomId/gifts
   */
  @Post()
  async sendGift(
    @Param("roomId") roomId: string,
    @Body() body: unknown
  ) {
    const parsed = sendGiftSchema.parse(body);
    const { toUserId, amount, giftId, fromUserId } = parsed;
    
    // In test mode, allow fromUserId in body, otherwise extract from token
    let finalFromUserId = fromUserId;

    if (this.testMode) {
      // Test mode: use fromUserId from body or default
      finalFromUserId = fromUserId || "test-user-1";
    } else {
      // Production: extract from token (would need proper JWT parsing)
      if (!fromUserId) {
        throw new Error("fromUserId is required or provide valid JWT token");
      }
      finalFromUserId = fromUserId;
    }

    if (!finalFromUserId) {
      throw new Error("fromUserId is required");
    }

    return await this.giftService.sendGift(roomId, finalFromUserId, toUserId, amount, giftId);
  }

  /**
   * Get gifts for a room
   * GET /streaming/rooms/:roomId/gifts
   */
  @Get()
  async getRoomGifts(@Param("roomId") roomId: string) {
    return await this.giftService.getRoomGifts(roomId);
  }

}

