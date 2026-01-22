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
        isActive: true
      }
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
   * Validate gift ID and amount match
   */
  async validateGift(giftId: string, amount: number): Promise<void> {
    const gift = await this.getGift(giftId);

    if (gift.coins !== amount) {
      throw new BadRequestException(
        `Gift amount mismatch. Gift ${giftId} costs ${gift.coins} coins, but ${amount} was provided`
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
        coins: true
      },
      orderBy: {
        coins: "asc"
      }
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
