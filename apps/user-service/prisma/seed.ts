import { PrismaClient } from "@prisma/client";
import fetch from "node-fetch";

const prisma = new PrismaClient();

// Helper function to fetch brand logo from Brandfetch (optional)
async function fetchBrandLogo(domain: string): Promise<string | null> {
  const apiKey = process.env.BRANDFETCH_API_KEY;
  if (!apiKey) {
    return null; // Brandfetch not configured, skip logo fetching
  }

  try {
    const url = `https://api.brandfetch.io/v2/brands/${domain}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as { images?: { logo?: string; icon?: string }; logo?: string };
    return data.images?.logo || data.images?.icon || data.logo || null;
  } catch (error) {
    console.warn(`Failed to fetch logo for ${domain}:`, error);
    return null;
  }
}

async function main() {
  console.log("🌱 Starting seed...");

  // Seed Brands
  console.log("📦 Seeding brands...");
  // Brand name to domain mapping for Brandfetch API
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

  const hasBrandfetch = !!process.env.BRANDFETCH_API_KEY;
  if (hasBrandfetch) {
    console.log("🔍 Fetching brand logos from Brandfetch...");
  } else {
    console.log("⚠️  BRANDFETCH_API_KEY not set - logos will be fetched automatically when brands are accessed");
  }

  for (const brand of brands) {
    let logoUrl: string | null = null;
    
    // Try to fetch logo if Brandfetch is configured
    if (hasBrandfetch) {
      logoUrl = await fetchBrandLogo(brand.domain);
      if (logoUrl) {
        console.log(`  ✓ Fetched logo for ${brand.name}`);
      }
    }

    // Check if brand exists to see if it has a logo already
    const existing = await prisma.brand.findUnique({
      where: { name: brand.name }
    });

    await prisma.brand.upsert({
      where: { name: brand.name },
      update: {
        domain: brand.domain,
        // Only update logoUrl if we fetched a new one OR if brand doesn't have one
        ...(logoUrl && !existing?.logoUrl ? { logoUrl } : {})
      },
      create: {
        name: brand.name,
        domain: brand.domain,
        logoUrl
      }
    });
  }
  console.log(`✅ Seeded ${brands.length} brands${hasBrandfetch ? ' with logos' : ''}`);

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

