import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting seed...");

  // Seed Brands
  console.log("📦 Seeding brands...");
  // Note: Update logoUrl values with actual CDN/file storage URLs for production
  // Logo images should be hosted on your file storage (Cloudflare R2, AWS S3, etc.)
  const brands = [
    { name: "JBL", logoUrl: null }, // TODO: Add logo URL: "https://your-cdn.com/logos/jbl.png"
    { name: "Apple", logoUrl: null }, // TODO: Add logo URL: "https://your-cdn.com/logos/apple.png"
    { name: "Nike", logoUrl: null }, // TODO: Add logo URL: "https://your-cdn.com/logos/nike.png"
    { name: "BMW", logoUrl: null }, // TODO: Add logo URL: "https://your-cdn.com/logos/bmw.png"
    { name: "Adidas", logoUrl: null }, // TODO: Add logo URL: "https://your-cdn.com/logos/adidas.png"
    { name: "Samsung", logoUrl: null }, // TODO: Add logo URL: "https://your-cdn.com/logos/samsung.png"
    { name: "Sony", logoUrl: null }, // TODO: Add logo URL: "https://your-cdn.com/logos/sony.png"
    { name: "Tesla", logoUrl: null }, // TODO: Add logo URL: "https://your-cdn.com/logos/tesla.png"
    { name: "Gucci", logoUrl: null }, // TODO: Add logo URL: "https://your-cdn.com/logos/gucci.png"
    { name: "Chanel", logoUrl: null }, // TODO: Add logo URL: "https://your-cdn.com/logos/chanel.png"
    { name: "Bose", logoUrl: null }, // TODO: Add logo URL: "https://your-cdn.com/logos/bose.png"
    { name: "Mercedes-Benz", logoUrl: null }, // TODO: Add logo URL: "https://your-cdn.com/logos/mercedes-benz.png"
    { name: "Puma", logoUrl: null }, // TODO: Add logo URL: "https://your-cdn.com/logos/puma.png"
    { name: "Microsoft", logoUrl: null }, // TODO: Add logo URL: "https://your-cdn.com/logos/microsoft.png"
    { name: "Google", logoUrl: null } // TODO: Add logo URL: "https://your-cdn.com/logos/google.png"
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

