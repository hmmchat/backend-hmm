import { Injectable, Logger, BadRequestException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { WalletClientService } from "./wallet-client.service.js";

@Injectable()
export class GiftService {
  private readonly logger = new Logger(GiftService.name);

  constructor(
    private prisma: PrismaService,
    private walletClient: WalletClientService
  ) {}

  /**
   * Send a gift (transfer coins) in a room
   * @param giftId Gift sticker ID (monkey, pikachu, etc.) - required
   */
  async sendGift(
    roomId: string,
    fromUserId: string,
    toUserId: string,
    amount: number,
    giftId: string
  ): Promise<{ transactionId: string; newBalance: number }> {
    if (amount <= 0) {
      throw new BadRequestException("Gift amount must be positive");
    }

    if (!giftId || giftId.trim() === "") {
      throw new BadRequestException("giftId is required");
    }

    if (fromUserId === toUserId) {
      throw new BadRequestException("Cannot send gift to yourself");
    }

    const session = await this.prisma.callSession.findUnique({
      where: { roomId },
      include: {
        participants: true,
        viewers: true
      }
    });

    if (!session) {
      throw new NotFoundException(`Session for room ${roomId} not found`);
    }

    // Verify both users are in the room (participant or viewer)
    const fromUserInRoom = session.participants.some(p => p.userId === fromUserId) ||
                          session.viewers.some(v => v.userId === fromUserId);
    const toUserInRoom = session.participants.some(p => p.userId === toUserId) ||
                        session.viewers.some(v => v.userId === toUserId);

    if (!fromUserInRoom) {
      throw new BadRequestException("Sender is not in the room");
    }

    if (!toUserInRoom) {
      throw new BadRequestException("Recipient is not in the room");
    }

    // Transfer coins from sender to receiver via wallet-service
    const result = await this.walletClient.transferCoins(
      fromUserId,
      toUserId,
      amount,
      `Gift to user ${toUserId} in room ${roomId}`,
      giftId // Pass giftId to wallet service
    );

    // Create gift record
    await this.prisma.callGift.create({
      data: {
        sessionId: session.id,
        fromUserId,
        toUserId,
        amount,
        giftId: giftId, // Store giftId in CallGift
        transactionId: result.transactionId
      }
    });

    this.logger.log(`Gift sent: ${fromUserId} -> ${toUserId} (${amount} coins) in room ${roomId}`);

    return {
      transactionId: result.transactionId,
      newBalance: result.newBalance
    };
  }

  /**
   * Get gifts for a room
   */
  async getRoomGifts(roomId: string): Promise<Array<{
    id: string;
    fromUserId: string;
    toUserId: string;
    amount: number;
    createdAt: Date;
  }>> {
    const session = await this.prisma.callSession.findUnique({
      where: { roomId }
    });

    if (!session) {
      return [];
    }

    const gifts = await this.prisma.callGift.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "desc" }
    });

    return gifts.map(gift => ({
      id: gift.id,
      fromUserId: gift.fromUserId,
      toUserId: gift.toUserId,
      amount: gift.amount,
      createdAt: gift.createdAt
    }));
  }
}
