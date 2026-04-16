import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

type SeedGift = {
  giftId: string;
  name: string;
  emoji: string;
  coins: number;
  diamonds: number;
  imageUrl: string;
};

const DEFAULT_GIFTS: SeedGift[] = [
  { giftId: "monkey", name: "Monkey", emoji: "🐵", coins: 0, diamonds: 50, imageUrl: "/gift/gift1.png" },
  { giftId: "pikachu", name: "Pikachu", emoji: "⚡", coins: 0, diamonds: 100, imageUrl: "/gift/gift2.png" },
  { giftId: "rose", name: "Rose", emoji: "🌹", coins: 0, diamonds: 200, imageUrl: "/gift/gift3.png" },
  { giftId: "diamond", name: "Diamond", emoji: "💎", coins: 0, diamonds: 500, imageUrl: "/gift/gift4.png" },
  { giftId: "heart", name: "Heart", emoji: "❤️", coins: 0, diamonds: 100, imageUrl: "/gift/gift5.png" },
  { giftId: "star", name: "Star", emoji: "⭐", coins: 0, diamonds: 150, imageUrl: "/gift/gift6.png" },
  { giftId: "fire", name: "Fire", emoji: "🔥", coins: 0, diamonds: 250, imageUrl: "/gift/gift7.png" },
  { giftId: "crown", name: "Crown", emoji: "👑", coins: 0, diamonds: 1000, imageUrl: "/gift/gift8.png" }
];

function truthy(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "y" || s === "on";
}

@Injectable()
export class GiftSeedService implements OnModuleInit {
  private readonly logger = new Logger(GiftSeedService.name);
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    // This is a one-time initializer for environments where the DB starts empty.
    // It is intentionally gated behind an env var so gifts remain dashboard-driven.
    if (!truthy(process.env.SEED_DEFAULT_GIFTS_ON_START)) return;

    try {
      const count = await this.prisma.gift.count();
      if (count > 0) return;

      this.logger.warn("Gift catalog is empty. Seeding default gifts (SEED_DEFAULT_GIFTS_ON_START enabled).");
      for (const g of DEFAULT_GIFTS) {
        await this.prisma.gift.upsert({
          where: { giftId: g.giftId },
          update: {
            name: g.name,
            emoji: g.emoji,
            coins: g.coins,
            diamonds: g.diamonds,
            imageUrl: g.imageUrl,
            isActive: true
          } as any,
          create: {
            giftId: g.giftId,
            name: g.name,
            emoji: g.emoji,
            coins: g.coins,
            diamonds: g.diamonds,
            imageUrl: g.imageUrl,
            isActive: true
          } as any
        });
      }
      this.logger.log(`Seeded ${DEFAULT_GIFTS.length} default gifts.`);
    } catch (e: any) {
      this.logger.error(`Failed to seed default gifts: ${e?.message || String(e)}`);
      // Don't crash startup; dashboard/admin can still create gifts manually.
    }
  }
}

