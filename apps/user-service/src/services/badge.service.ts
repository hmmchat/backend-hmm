import { Injectable, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { WalletClientService } from "./wallet-client.service.js";

// Gift list matching streaming service
const GIFT_LIST = [
  { id: "monkey", name: "Monkey", emoji: "🐵" },
  { id: "pikachu", name: "Pikachu", emoji: "⚡" },
  { id: "superman", name: "Superman", emoji: "🦸" },
  { id: "ironman", name: "Iron Man", emoji: "🤖" }
];

@Injectable()
export class BadgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletClient: WalletClientService
  ) {}

  /**
   * Get all gifts received by user (from wallet transactions)
   */
  async getReceivedGifts(userId: string): Promise<Array<{
    giftId: string;
    giftName: string;
    giftEmoji: string;
    receivedAt: Date;
  }>> {
    // Get badges from UserBadge table
    // @ts-ignore - Prisma client needs regeneration, UserBadge model exists in schema
    const badges = await (this.prisma as any).userBadge.findMany({
      where: { userId },
      orderBy: { receivedAt: "desc" }
    });

    return badges.map(badge => ({
      giftId: badge.giftId,
      giftName: badge.giftName,
      giftEmoji: badge.giftEmoji || "",
      receivedAt: badge.receivedAt
    }));
  }

  /**
   * Sync badges from wallet transactions
   * This should be called when user views their wallet or badges
   */
  async syncBadgesFromTransactions(userId: string): Promise<void> {
    // Get gift transactions from wallet service
    const giftTransactions = await this.walletClient.getGiftTransactions(userId);

    for (const transaction of giftTransactions) {
      if (!transaction.giftId) continue;

      const gift = GIFT_LIST.find(g => g.id === transaction.giftId);
      if (!gift) continue;

      // Check if badge already exists
      // @ts-ignore - Prisma client needs regeneration, UserBadge model exists in schema
      const existingBadge = await (this.prisma as any).userBadge.findUnique({
        where: {
          userId_giftId: {
            userId,
            giftId: transaction.giftId
          }
        }
      });

      if (!existingBadge) {
        // Create new badge
        // @ts-ignore - Prisma client needs regeneration, UserBadge model exists in schema
        await (this.prisma as any).userBadge.create({
          data: {
            userId,
            giftId: transaction.giftId,
            giftName: gift.name,
            giftEmoji: gift.emoji,
            receivedAt: transaction.createdAt
          }
        });
      }
    }
  }

  /**
   * Set active badge for user profile
   */
  async setActiveBadge(userId: string, giftId: string | null): Promise<void> {
    if (giftId === null) {
      // Remove active badge
      // @ts-ignore - Prisma client needs regeneration, activeBadgeId field exists in schema
      await this.prisma.user.update({
        where: { id: userId },
        // @ts-ignore
        data: { activeBadgeId: null }
      });
      return;
    }

    // Verify user has this badge
    // @ts-ignore - Prisma client needs regeneration, UserBadge model exists in schema
    const badge = await (this.prisma as any).userBadge.findUnique({
      where: {
        userId_giftId: {
          userId,
          giftId
        }
      }
    });

    if (!badge) {
      throw new BadRequestException(`User does not have badge: ${giftId}`);
    }

    // @ts-ignore - Prisma client needs regeneration, activeBadgeId field exists in schema
    await this.prisma.user.update({
      where: { id: userId },
      // @ts-ignore
      data: { activeBadgeId: giftId }
    });
  }

  /**
   * Get user's active badge
   */
  async getActiveBadge(userId: string): Promise<{
    giftId: string;
    giftName: string;
    giftEmoji: string;
  } | null> {
    // @ts-ignore - Prisma client needs regeneration, activeBadgeId field exists in schema
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      // @ts-ignore
      select: { activeBadgeId: true }
    });

    // @ts-ignore
    if (!user || !user.activeBadgeId) {
      return null;
    }

    // @ts-ignore - Prisma client needs regeneration, UserBadge model exists in schema
    const badge = await (this.prisma as any).userBadge.findUnique({
      where: {
        userId_giftId: {
          userId,
          // @ts-ignore
          giftId: user.activeBadgeId
        }
      }
    });

    if (!badge) {
      return null;
    }

    return {
      giftId: badge.giftId,
      giftName: badge.giftName,
      giftEmoji: badge.giftEmoji || ""
    };
  }
}
