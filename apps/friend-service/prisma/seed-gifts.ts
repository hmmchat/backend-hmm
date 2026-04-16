import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const GIFT_LIST = [
  { giftId: "monkey", name: "Monkey", emoji: "🐵", coins: 0, diamonds: 50, imageUrl: "/gift/gift1.png" },
  { giftId: "pikachu", name: "Pikachu", emoji: "⚡", coins: 0, diamonds: 100, imageUrl: "/gift/gift2.png" },
  { giftId: "rose", name: "Rose", emoji: "🌹", coins: 0, diamonds: 200, imageUrl: "/gift/gift3.png" },
  { giftId: "diamond", name: "Diamond", emoji: "💎", coins: 0, diamonds: 500, imageUrl: "/gift/gift4.png" },
  { giftId: "heart", name: "Heart", emoji: "❤️", coins: 0, diamonds: 100, imageUrl: "/gift/gift5.png" },
  { giftId: "star", name: "Star", emoji: "⭐", coins: 0, diamonds: 150, imageUrl: "/gift/gift6.png" },
  { giftId: "fire", name: "Fire", emoji: "🔥", coins: 0, diamonds: 250, imageUrl: "/gift/gift7.png" },
  { giftId: "crown", name: "Crown", emoji: "👑", coins: 0, diamonds: 1000, imageUrl: "/gift/gift8.png" }
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
        imageUrl: gift.imageUrl,
        isActive: true
      },
      create: {
        giftId: gift.giftId,
        name: gift.name,
        emoji: gift.emoji,
        coins: gift.coins,
        diamonds: gift.diamonds,
        imageUrl: gift.imageUrl,
        isActive: true
      }
    });

    console.log(`✓ Seeded gift: ${gift.giftId} (${gift.emoji} ${gift.name}) - ${gift.diamonds} diamonds`);
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
