import { Injectable, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { WalletClientService } from "./wallet-client.service.js";

export type UserStickerBadge = {
  id: string;
  giftId: string;
  giftName: string;
  giftEmoji: string;
  walletTransactionId?: string | null;
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
      walletTransactionId: (badge as any).walletTransactionId || null,
      receivedAt: badge.receivedAt,
      expiresAt: badge.expiresAt
    };
  }

  private mapTransactionToBadge(transaction: {
    id: string;
    giftId: string | null;
    createdAt: Date;
  }, persisted?: any): UserStickerBadge | null {
    if (!transaction.giftId) return null;
    const receivedAt = transaction.createdAt;
    return {
      id: persisted?.id || transaction.id,
      giftId: transaction.giftId,
      giftName: persisted?.giftName || transaction.giftId,
      giftEmoji: persisted?.giftEmoji || "🎁",
      walletTransactionId: transaction.id,
      receivedAt,
      expiresAt: persisted?.expiresAt || this.computeExpiresAt(receivedAt)
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
        OR: [
          { id: user.activeBadgeId },
          { walletTransactionId: user.activeBadgeId },
          { giftId: user.activeBadgeId }
        ],
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
    const [persistedBadges, giftTransactions] = await Promise.all([
      (this.prisma as any).userBadge.findMany({
        where: {
          userId,
          expiresAt: { gt: now }
        },
        orderBy: { receivedAt: "desc" }
      }),
      this.walletClient.getGiftTransactions(userId).catch(() => [])
    ]);

    const byTransactionId = new Map<string, any>();
    for (const badge of persistedBadges) {
      if (badge.walletTransactionId) {
        byTransactionId.set(badge.walletTransactionId, badge);
      }
    }

    const transactionBadges = giftTransactions
      .map((transaction) => this.mapTransactionToBadge(transaction, byTransactionId.get(transaction.id)))
      .filter((badge): badge is UserStickerBadge => Boolean(badge))
      .filter((badge) => badge.expiresAt > now);

    const transactionIds = new Set(transactionBadges.map((badge) => badge.walletTransactionId).filter(Boolean));
    const legacyBadges = persistedBadges
      .filter((badge: any) => !badge.walletTransactionId || !transactionIds.has(badge.walletTransactionId))
      .map((badge: any) => this.mapBadgeRow(badge));

    const badges = [...transactionBadges, ...legacyBadges].sort(
      (a, b) => b.receivedAt.getTime() - a.receivedAt.getTime()
    );

    return {
      stickerExpiryDays: this.getStickerExpiryDays(),
      badges
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

      try {
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
      } catch {
        // Listing uses wallet transactions as source of truth; a single sync conflict
        // should not hide the user's other stickers.
      }
    }
  }

  private async ensureBadgeForTransactionId(userId: string, transactionId: string) {
    const existing = await (this.prisma as any).userBadge.findUnique({
      where: { walletTransactionId: transactionId }
    });
    if (existing) return existing;

    const transactions = await this.walletClient.getGiftTransactions(userId);
    const transaction = transactions.find((tx) => tx.id === transactionId);
    if (!transaction?.giftId) return null;

    return (this.prisma as any).userBadge.create({
      data: {
        userId,
        giftId: transaction.giftId,
        giftName: transaction.giftId,
        giftEmoji: "🎁",
        walletTransactionId: transaction.id,
        receivedAt: transaction.createdAt,
        expiresAt: this.computeExpiresAt(transaction.createdAt)
      }
    });
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
    let badge = await (this.prisma as any).userBadge.findFirst({
      where: {
        id: badgeId,
        userId,
        expiresAt: { gt: now }
      }
    });

    if (!badge) {
      const fromTransaction = await this.ensureBadgeForTransactionId(userId, badgeId);
      if (fromTransaction?.expiresAt > now) {
        badge = fromTransaction;
      }
    }

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
        OR: [
          { id: user.activeBadgeId },
          { walletTransactionId: user.activeBadgeId },
          { giftId: user.activeBadgeId }
        ],
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
        OR: [
          { id: activeBadgeId },
          { walletTransactionId: activeBadgeId },
          { giftId: activeBadgeId }
        ],
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
