import { Injectable, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { WalletClientService } from "./wallet-client.service.js";

export type UserStickerBadge = {
  id: string;
  giftId: string;
  giftName: string;
  giftEmoji: string;
  receivedAt: Date;
  expiresAt: Date;
};

@Injectable()
export class BadgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletClient: WalletClientService
  ) {}

  getStickerExpiryDays(): number {
    const parsed = Number.parseInt(process.env.STICKER_EXPIRY_DAYS || "7", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 7;
  }

  private computeExpiresAt(receivedAt: Date): Date {
    const days = this.getStickerExpiryDays();
    return new Date(receivedAt.getTime() + days * 24 * 60 * 60 * 1000);
  }

  private mapBadgeRow(badge: {
    id: string;
    giftId: string;
    giftName: string;
    giftEmoji: string | null;
    receivedAt: Date;
    expiresAt: Date;
  }): UserStickerBadge {
    return {
      id: badge.id,
      giftId: badge.giftId,
      giftName: badge.giftName,
      giftEmoji: badge.giftEmoji || "",
      receivedAt: badge.receivedAt,
      expiresAt: badge.expiresAt
    };
  }

  private async clearActiveBadgeIfInvalid(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { activeBadgeId: true }
    });
    if (!user?.activeBadgeId) return;

    const now = new Date();
    const active = await (this.prisma as any).userBadge.findFirst({
      where: {
        userId,
        OR: [{ id: user.activeBadgeId }, { giftId: user.activeBadgeId }],
        expiresAt: { gt: now }
      }
    });

    if (!active) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { activeBadgeId: null }
      });
      return;
    }

    if (active.id !== user.activeBadgeId) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { activeBadgeId: active.id }
      });
    }
  }

  async getStickersPayload(userId: string): Promise<{
    stickerExpiryDays: number;
    badges: UserStickerBadge[];
  }> {
    await this.clearActiveBadgeIfInvalid(userId);

    const now = new Date();
    const badges = await (this.prisma as any).userBadge.findMany({
      where: {
        userId,
        expiresAt: { gt: now }
      },
      orderBy: { receivedAt: "desc" }
    });

    return {
      stickerExpiryDays: this.getStickerExpiryDays(),
      badges: badges.map((badge: any) => this.mapBadgeRow(badge))
    };
  }

  /**
   * Sync one UserBadge row per gift credit transaction (duplicates allowed per giftId).
   */
  async syncBadgesFromTransactions(userId: string): Promise<void> {
    const giftTransactions = await this.walletClient.getGiftTransactions(userId);

    for (const transaction of giftTransactions) {
      if (!transaction.giftId) continue;

      const receivedAt = transaction.createdAt;
      const expiresAt = this.computeExpiresAt(receivedAt);

      if (transaction.id) {
        const existingByTx = await (this.prisma as any).userBadge.findUnique({
          where: { walletTransactionId: transaction.id }
        });
        if (existingByTx) continue;
      }

      await (this.prisma as any).userBadge.create({
        data: {
          userId,
          giftId: transaction.giftId,
          giftName: transaction.giftId,
          giftEmoji: "🎁",
          walletTransactionId: transaction.id || null,
          receivedAt,
          expiresAt
        }
      });
    }
  }

  /**
   * Set active sticker instance on profile (UserBadge.id).
   */
  async setActiveBadge(userId: string, badgeId: string | null): Promise<void> {
    if (badgeId === null) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { activeBadgeId: null }
      });
      return;
    }

    const now = new Date();
    const badge = await (this.prisma as any).userBadge.findFirst({
      where: {
        id: badgeId,
        userId,
        expiresAt: { gt: now }
      }
    });

    if (!badge) {
      throw new BadRequestException(`Sticker ${badgeId} not found or expired`);
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { activeBadgeId: badge.id }
    });
  }

  async getActiveBadge(userId: string): Promise<UserStickerBadge | null> {
    await this.clearActiveBadgeIfInvalid(userId);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { activeBadgeId: true }
    });

    if (!user?.activeBadgeId) {
      return null;
    }

    const now = new Date();
    const badge = await (this.prisma as any).userBadge.findFirst({
      where: {
        userId,
        OR: [{ id: user.activeBadgeId }, { giftId: user.activeBadgeId }],
        expiresAt: { gt: now }
      },
      orderBy: { receivedAt: "desc" }
    });

    if (!badge) {
      return null;
    }

    return this.mapBadgeRow(badge);
  }

  /** Resolve active badge row for profile embedding. */
  async resolveActiveBadgeForUser(userId: string, activeBadgeId: string | null) {
    if (!activeBadgeId) return null;

    const now = new Date();
    const badge = await (this.prisma as any).userBadge.findFirst({
      where: {
        userId,
        OR: [{ id: activeBadgeId }, { giftId: activeBadgeId }],
        expiresAt: { gt: now }
      },
      orderBy: { receivedAt: "desc" }
    });

    if (!badge) return null;

    return {
      id: badge.id,
      giftId: badge.giftId,
      giftName: badge.giftName,
      giftEmoji: badge.giftEmoji || "",
      expiresAt: badge.expiresAt
    };
  }
}
