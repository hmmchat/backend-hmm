import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const GIFT_LIST = [
  { giftId: "monkey", name: "Monkey", emoji: "🐵", coins: 50, diamonds: 50 },
  { giftId: "pikachu", name: "Pikachu", emoji: "⚡", coins: 100, diamonds: 100 },
  { giftId: "rose", name: "Rose", emoji: "🌹", coins: 200, diamonds: 200 },
  { giftId: "diamond", name: "Diamond", emoji: "💎", coins: 500, diamonds: 500 },
  { giftId: "heart", name: "Heart", emoji: "❤️", coins: 100, diamonds: 100 },
  { giftId: "star", name: "Star", emoji: "⭐", coins: 150, diamonds: 150 },
  { giftId: "fire", name: "Fire", emoji: "🔥", coins: 250, diamonds: 250 },
  { giftId: "crown", name: "Crown", emoji: "👑", coins: 1000, diamonds: 1000 }
];

async function main() {
  console.log("Seeding gift catalog...");

  for (const gift of GIFT_LIST) {
    await prisma.gift.upsert({
      where: { giftId: gift.giftId },
      update: {
        name: gift.name,
        emoji: gift.emoji,
        coins: gift.coins,
        diamonds: gift.diamonds,
        isActive: true
      },
      create: {
        giftId: gift.giftId,
        name: gift.name,
        emoji: gift.emoji,
        coins: gift.coins,
        diamonds: gift.diamonds,
        isActive: true
      }
    });

    console.log(`✓ Seeded gift: ${gift.giftId} (${gift.emoji} ${gift.name}) - ${gift.coins} coins / ${gift.diamonds} diamonds`);
  }

  console.log("Gift catalog seeded successfully!");
}

main()
  .catch((e) => {
    console.error("Error seeding gifts:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
