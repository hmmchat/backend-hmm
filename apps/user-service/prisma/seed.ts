import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Get logo URL for a brand. Uses BRAND_LOGO_BASE_URL when set.
 * Example: BRAND_LOGO_BASE_URL=https://cdn.example.com/brand-logos
 * -> apple.com yields https://cdn.example.com/brand-logos/apple.png
 */
function getLogoUrl(domain: string): string | null {
  const base = process.env.BRAND_LOGO_BASE_URL;
  if (!base || !domain) return null;
  const slug = domain.replace(/\.(com|io|co|org|net)$/, "").replace(/\./g, "-");
  return `${base.replace(/\/$/, "")}/${slug}.png`;
}

async function main() {
  console.log("🌱 Starting seed...");

  // Seed Brands
  console.log("📦 Seeding brands...");
  const brands = [
    { name: "JBL", domain: "jbl.com" },
    { name: "Apple", domain: "apple.com" },
    { name: "Nike", domain: "nike.com" },
    { name: "BMW", domain: "bmw.com" },
    { name: "Adidas", domain: "adidas.com" },
    { name: "Samsung", domain: "samsung.com" },
    { name: "Sony", domain: "sony.com" },
    { name: "Tesla", domain: "tesla.com" },
    { name: "Gucci", domain: "gucci.com" },
    { name: "Chanel", domain: "chanel.com" },
    { name: "Bose", domain: "bose.com" },
    { name: "Mercedes-Benz", domain: "mercedes-benz.com" },
    { name: "Puma", domain: "puma.com" },
    { name: "Microsoft", domain: "microsoft.com" },
    { name: "Google", domain: "google.com" }
  ];

  for (const brand of brands) {
    const logoUrl = getLogoUrl(brand.domain);
    if (logoUrl) {
      console.log(`  ✓ Logo URL for ${brand.name}: ${logoUrl}`);
    }

    const existing = await prisma.brand.findUnique({
      where: { name: brand.name }
    });

    await prisma.brand.upsert({
      where: { name: brand.name },
      update: {
        domain: brand.domain,
        ...(logoUrl && !existing?.logoUrl ? { logoUrl } : {})
      },
      create: {
        name: brand.name,
        domain: brand.domain,
        logoUrl
      }
    });
  }
  console.log(
    `✅ Seeded ${brands.length} brands${process.env.BRAND_LOGO_BASE_URL ? " with logo URLs" : " (set BRAND_LOGO_BASE_URL to add logos)"}`
  );

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
