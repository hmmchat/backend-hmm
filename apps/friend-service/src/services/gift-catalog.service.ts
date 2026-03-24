import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
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
  const trimmed = imageUrl?.trim();
  if (trimmed) return trimmed;
  return fallbackPresetGiftImagePath(giftId);
}

@Injectable()
export class GiftCatalogService {
  constructor(private readonly prisma: PrismaService) {}

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

    return gift;
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
    return await this.prisma.gift.findMany({
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
