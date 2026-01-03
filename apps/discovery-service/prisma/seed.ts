import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting discovery-service seed...");

  // Note: Gender filter configuration is now managed via environment variables:
  // - GENDER_FILTER_COINS_PER_SCREEN (default: 200)
  // - GENDER_FILTER_SCREENS_PER_PURCHASE (default: 10)

  // Seed test gender filter preferences (for testing)
  console.log("👥 Seeding test gender filter preferences...");
  
  const testPreferences = [
    {
      userId: "test-user-male-1",
      genders: ["MALE", "FEMALE"],
      screensRemaining: 5
    },
    {
      userId: "test-user-female-1",
      genders: ["FEMALE"],
      screensRemaining: 10
    },
    {
      userId: "test-user-nonbinary-1",
      genders: ["MALE", "FEMALE", "NON_BINARY"],
      screensRemaining: 15
    }
  ];

  for (const pref of testPreferences) {
    await prisma.genderFilterPreference.upsert({
      where: { userId: pref.userId },
      update: {
        genders: pref.genders,
        screensRemaining: pref.screensRemaining
      },
      create: {
        userId: pref.userId,
        genders: pref.genders,
        screensRemaining: pref.screensRemaining
      }
    });
  }
  console.log(`✅ Seeded ${testPreferences.length} test gender filter preferences`);

  console.log("🎉 Discovery-service seed completed successfully!");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

