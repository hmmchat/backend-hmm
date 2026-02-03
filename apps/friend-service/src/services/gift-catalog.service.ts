import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

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
        diamonds: true
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
}
