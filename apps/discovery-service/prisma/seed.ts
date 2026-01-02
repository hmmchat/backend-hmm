import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting discovery-service seed...");

  // Seed Gender Filter Configuration
  console.log("⚙️  Seeding gender filter configuration...");
  
  const configs = [
    {
      key: "gender_filter_coins_per_screen",
      value: "200",
      description: "Number of coins required per gender filter purchase"
    },
    {
      key: "gender_filter_screens_per_purchase",
      value: "10",
      description: "Number of screens/matches included per gender filter purchase"
    }
  ];

  for (const config of configs) {
    await prisma.genderFilterConfig.upsert({
      where: { key: config.key },
      update: {
        value: config.value,
        description: config.description
      },
      create: config
    });
  }
  console.log(`✅ Seeded ${configs.length} gender filter configurations`);

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

