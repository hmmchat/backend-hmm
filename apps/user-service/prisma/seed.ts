import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting seed...");

  // Seed Brands
  console.log("📦 Seeding brands...");
  const brands = [
    { name: "JBL" },
    { name: "Apple" },
    { name: "Nike" },
    { name: "BMW" },
    { name: "Adidas" },
    { name: "Samsung" },
    { name: "Sony" },
    { name: "Tesla" },
    { name: "Gucci" },
    { name: "Chanel" },
    { name: "Bose" },
    { name: "Mercedes-Benz" },
    { name: "Puma" },
    { name: "Microsoft" },
    { name: "Google" }
  ];

  for (const brand of brands) {
    await prisma.brand.upsert({
      where: { name: brand.name },
      update: {},
      create: brand
    });
  }
  console.log(`✅ Seeded ${brands.length} brands`);

  // Seed Interests
  console.log("🎯 Seeding interests...");
  const interests = [
    { name: "Music" },
    { name: "Sports" },
    { name: "Travel" },
    { name: "Photography" },
    { name: "Reading" },
    { name: "Cooking" },
    { name: "Gaming" },
    { name: "Movies" },
    { name: "Fitness" },
    { name: "Art" },
    { name: "Dancing" },
    { name: "Writing" },
    { name: "Technology" },
    { name: "Fashion" },
    { name: "Food" },
    { name: "Nature" },
    { name: "Adventure" },
    { name: "Yoga" },
    { name: "Cycling" },
    { name: "Singing" }
  ];

  for (const interest of interests) {
    await prisma.interest.upsert({
      where: { name: interest.name },
      update: {},
      create: interest
    });
  }
  console.log(`✅ Seeded ${interests.length} interests`);

  // Seed Values
  console.log("💎 Seeding values...");
  const values = [
    { name: "Honesty" },
    { name: "Adventure" },
    { name: "Family" },
    { name: "Friendship" },
    { name: "Loyalty" },
    { name: "Respect" },
    { name: "Kindness" },
    { name: "Integrity" },
    { name: "Independence" },
    { name: "Creativity" },
    { name: "Growth" },
    { name: "Balance" },
    { name: "Freedom" },
    { name: "Empathy" },
    { name: "Optimism" },
    { name: "Ambition" },
    { name: "Authenticity" },
    { name: "Compassion" },
    { name: "Excellence" },
    { name: "Positivity" }
  ];

  for (const value of values) {
    await prisma.value.upsert({
      where: { name: value.name },
      update: {},
      create: value
    });
  }
  console.log(`✅ Seeded ${values.length} values`);

  console.log("🎉 Seed completed successfully!");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

