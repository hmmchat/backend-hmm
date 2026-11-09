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
   * Send a gift (transfer diamonds) in a room
   * @param giftId Gift catalog ID - required
   * @param amount Amount in diamonds (gifts give diamonds)
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

    const isActiveParticipant = (userId: string) =>
      session.participants.some(
        (p) => p.userId === userId && p.leftAt == null && p.status !== "left"
      );
    const isActiveViewer = (userId: string) =>
      session.viewers.some((v) => v.userId === userId && v.leftAt == null);

    // A viewer may send. The recipient has to be on the call right now.
    if (!isActiveParticipant(fromUserId) && !isActiveViewer(fromUserId)) {
      throw new BadRequestException("Sender is not in the room");
    }

    if (!isActiveParticipant(toUserId)) {
      throw new BadRequestException("Recipient is not in the call");
    }

    // Transfer diamonds from sender to receiver (gifts give diamonds)
    const result = await this.walletClient.transferDiamonds(
      fromUserId,
      toUserId,
      amount,
      `Gift to user ${toUserId} in room ${roomId}`,
      giftId
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

    this.logger.log(`Gift sent: ${fromUserId} -> ${toUserId} (${amount} diamonds) in room ${roomId}`);

    return {
      transactionId: result.transactionId,
      newBalance: result.newDiamondBalance
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

  /**
   * Send a gift without room context (for OFFLINE cards)
   * Transfers diamonds and creates badge, but does NOT create CallGift record
   * @param giftId Gift catalog ID - required
   * @param amount Amount in diamonds
   */
  async sendGiftDirect(
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

    // Transfer diamonds from sender to receiver (gifts give diamonds)
    const result = await this.walletClient.transferDiamonds(
      fromUserId,
      toUserId,
      amount,
      `Gift to user ${toUserId} (from OFFLINE cards)`,
      giftId
    );

    // NOTE: We do NOT create a CallGift record here because there's no room/session
    // The badge is created by wallet-service when giftId is passed
    // This is intentional - OFFLINE cards gifts don't need room tracking

    this.logger.log(`Direct gift sent: ${fromUserId} -> ${toUserId} (${amount} diamonds, giftId: ${giftId}) from OFFLINE cards`);

    return {
      transactionId: result.transactionId,
      newBalance: result.newDiamondBalance
    };
  }
}
