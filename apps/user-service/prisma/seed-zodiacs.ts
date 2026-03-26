import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding zodiacs only...");

  const zodiacBaseUrl =
    process.env.ZODIAC_IMAGES_BASE_URL ||
    process.env.HOROSCOPE_IMAGES_BASE_URL ||
    process.env.FILES_SERVICE_PUBLIC_URL ||
    "https://cdn.hmmchat.live/horoscopes";
  const base = zodiacBaseUrl.replace(/\/$/, "");

  const zodiacDefs = [
    { name: "Aries", slug: "aries", order: 1 },
    { name: "Taurus", slug: "taurus", order: 2 },
    { name: "Gemini", slug: "gemini", order: 3 },
    { name: "Cancer", slug: "cancer", order: 4 },
    { name: "Leo", slug: "leo", order: 5 },
    { name: "Virgo", slug: "virgo", order: 6 },
    { name: "Libra", slug: "libra", order: 7 },
    { name: "Scorpio", slug: "scorpio", order: 8 },
    { name: "Sagittarius", slug: "sagittarius", order: 9 },
    { name: "Capricorn", slug: "capricorn", order: 10 },
    { name: "Aquarius", slug: "aquarius", order: 11 },
    { name: "Pisces", slug: "pisces", order: 12 },
  ];

  for (const z of zodiacDefs) {
    const imageUrl = `${base}/${z.slug}.png`;
    await prisma.zodiac.upsert({
      where: { name: z.name },
      update: { imageUrl, order: z.order },
      create: { name: z.name, imageUrl, order: z.order },
    });
  }

  console.log(`✅ Seeded ${zodiacDefs.length} zodiacs`);
}

main()
  .catch((e) => {
    console.error("❌ Zodiac seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

