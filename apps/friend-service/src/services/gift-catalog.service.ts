import { Injectable, NotFoundException, BadRequestException, Logger, OnModuleInit } from "@nestjs/common";
import { rewriteExpiredStorageUrl, rewrittenStorageUrlOrNull } from "@hmm/common";
import { PrismaService } from "../prisma/prisma.service.js";

/** Stable preset art when `imageUrl` is unset (giftId is often a UUID, not a filename). */
const PRESET_GIFT_COUNT = 8;

export function fallbackPresetGiftImagePath(giftId: string): string {
  let h = 0;
  for (let i = 0; i < giftId.length; i++) {
    h = Math.imul(31, h) + giftId.charCodeAt(i) | 0;
  }
  const idx = (Math.abs(h) % PRESET_GIFT_COUNT) + 1;
  return `/gift/gift${idx}.png`;
}

export function resolveGiftStickerUrl(imageUrl: string | null | undefined, giftId: string): string {
  const trimmed = rewriteExpiredStorageUrl(imageUrl?.trim() || null);
  if (trimmed) return trimmed;
  return fallbackPresetGiftImagePath(giftId);
}

@Injectable()
export class GiftCatalogService implements OnModuleInit {
  private readonly logger = new Logger(GiftCatalogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.rewriteExpiredGiftUrls();
  }

  private withPublicImageUrl<T extends { imageUrl?: string | null }>(gift: T): T {
    if (!gift?.imageUrl) return gift;
    return { ...gift, imageUrl: rewriteExpiredStorageUrl(gift.imageUrl) ?? gift.imageUrl };
  }

  private async rewriteExpiredGiftUrls() {
    try {
      const gifts = await this.prisma.gift.findMany({
        select: { id: true, imageUrl: true }
      });
      let updated = 0;
      for (const gift of gifts) {
        const next = rewrittenStorageUrlOrNull(gift.imageUrl);
        if (!next) continue;
        await this.prisma.gift.update({
          where: { id: gift.id },
          data: { imageUrl: next }
        });
        updated++;
      }

      const campaigns = await (this.prisma as any).notificationCampaign.findMany({
        select: { id: true, imagesJson: true }
      }).catch(() => []);
      for (const campaign of campaigns) {
        if (!campaign.imagesJson) continue;
        let images: unknown;
        try {
          images = JSON.parse(campaign.imagesJson);
        } catch {
          continue;
        }
        if (!Array.isArray(images)) continue;
        const rewritten = images.map((item) =>
          typeof item === "string" ? rewriteExpiredStorageUrl(item) : item
        );
        if (JSON.stringify(rewritten) === JSON.stringify(images)) continue;
        await (this.prisma as any).notificationCampaign.update({
          where: { id: campaign.id },
          data: { imagesJson: JSON.stringify(rewritten) }
        });
        updated++;
      }

      if (updated > 0) {
        this.logger.log(`Rewrote ${updated} expired gift/notification URL(s)`);
      }
    } catch (error: any) {
      this.logger.warn(`Gift URL rewrite skipped: ${error?.message || error}`);
    }
  }

  /**
   * Get gift by giftId
   */
  async getGift(giftId: string) {
    const gift = await this.prisma.gift.findUnique({
      where: { giftId },
      select: {
        id: true,
        giftId: true,
        name: true,
        emoji: true,
        coins: true,
        diamonds: true,
        imageUrl: true,
        isActive: true
      } as any // diamonds added for decoupled coins/diamonds; Prisma client may need regenerate
    });

    if (!gift) {
      throw new NotFoundException(`Gift with ID ${giftId} not found`);
    }

    if (!gift.isActive) {
      throw new BadRequestException(`Gift ${giftId} is not active`);
    }

    return this.withPublicImageUrl(gift);
  }

  /**
   * Validate gift ID and amount match (amount is in diamonds)
   */
  async validateGift(giftId: string, amount: number): Promise<void> {
    const gift = await this.getGift(giftId) as unknown as { coins: number; diamonds?: number };
    const diamondCost = gift.diamonds ?? gift.coins ?? 0;

    if (diamondCost !== amount) {
      throw new BadRequestException(
        `Gift amount mismatch. Gift ${giftId} costs ${diamondCost} diamonds, but ${amount} was provided`
      );
    }
  }

  /**
   * Get all active gifts
   */
  async getAllActiveGifts() {
    const gifts = await this.prisma.gift.findMany({
      where: { isActive: true },
      select: {
        id: true,
        giftId: true,
        name: true,
        emoji: true,
        coins: true,
        diamonds: true,
        imageUrl: true
      } as any,
      orderBy: {
        diamonds: "asc"
      } as any
    });
    return gifts.map((gift) => this.withPublicImageUrl(gift));
  }

  /**
   * Check if gift exists and is active
   */
  async giftExists(giftId: string): Promise<boolean> {
    const gift = await this.prisma.gift.findUnique({
      where: { giftId },
      select: { isActive: true }
    });

    return gift !== null && gift.isActive;
  }

  /**
   * Adds `giftImageUrl` for GIFT rows so clients need not guess `/gift/{giftId}.png`.
   */
  async attachGiftImageUrls<T extends { giftId?: string | null }>(
    messages: T[]
  ): Promise<Array<T & { giftImageUrl?: string }>> {
    const ids = [...new Set(messages.map((m) => m.giftId).filter(Boolean) as string[])];
    if (ids.length === 0) {
      return messages.map((m) => ({ ...m }));
    }
    const rows = await this.prisma.gift.findMany({
      where: { giftId: { in: ids } },
      select: { giftId: true, imageUrl: true }
    });
    const byGiftId = new Map(
      rows.map((r) => [r.giftId, resolveGiftStickerUrl(r.imageUrl, r.giftId)])
    );
    return messages.map((m) => {
      const gid = m.giftId;
      if (!gid) return { ...m };
      const url = byGiftId.get(gid) ?? fallbackPresetGiftImagePath(gid);
      return { ...m, giftImageUrl: url };
    });
  }
}
