import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const GIFT_LIST = [
  { giftId: "monkey", name: "Monkey", emoji: "🐵", coins: 50 },
  { giftId: "pikachu", name: "Pikachu", emoji: "⚡", coins: 100 },
  { giftId: "rose", name: "Rose", emoji: "🌹", coins: 200 },
  { giftId: "diamond", name: "Diamond", emoji: "💎", coins: 500 },
  { giftId: "heart", name: "Heart", emoji: "❤️", coins: 100 },
  { giftId: "star", name: "Star", emoji: "⭐", coins: 150 },
  { giftId: "fire", name: "Fire", emoji: "🔥", coins: 250 },
  { giftId: "crown", name: "Crown", emoji: "👑", coins: 1000 }
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
        isActive: true
      },
      create: {
        giftId: gift.giftId,
        name: gift.name,
        emoji: gift.emoji,
        coins: gift.coins,
        isActive: true
      }
    });

    console.log(`✓ Seeded gift: ${gift.giftId} (${gift.emoji} ${gift.name}) - ${gift.coins} coins`);
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
