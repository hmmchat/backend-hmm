import { PrismaClient, Gender, UserStatus } from "@prisma/client";

const prisma = new PrismaClient();

// Test user data - creates diverse users for testing discovery flow
const testUsers = [
  // Mumbai Users - MALE
  {
    id: `test-user-mumbai-male-1`,
    username: "Rahul",
    gender: Gender.MALE,
    city: "Mumbai",
    status: UserStatus.AVAILABLE,
    brands: ["Nike", "Apple", "JBL"],
    interests: ["Music", "Sports", "Travel"],
    values: ["Adventure", "Honesty", "Friendship"],
    music: { name: "Shape of You", artist: "Ed Sheeran" },
    intent: "Looking for meaningful connections",
    age: 25
  },
  {
    id: `test-user-mumbai-male-2`,
    username: "Arjun",
    gender: Gender.MALE,
    city: "Mumbai",
    status: UserStatus.AVAILABLE,
    brands: ["Adidas", "Samsung", "Sony"],
    interests: ["Gaming", "Technology", "Fitness"],
    values: ["Growth", "Ambition", "Excellence"],
    music: { name: "Blinding Lights", artist: "The Weeknd" },
    intent: "Here to meet new people",
    age: 28
  },
  {
    id: `test-user-mumbai-male-3`,
    username: "Vikram",
    gender: Gender.MALE,
    city: "Mumbai",
    status: UserStatus.IN_SQUAD_AVAILABLE,
    brands: ["BMW", "Gucci", "Bose"],
    interests: ["Fashion", "Art", "Photography"],
    values: ["Creativity", "Authenticity", "Balance"],
    music: { name: "Watermelon Sugar", artist: "Harry Styles" },
    intent: "Exploring new connections",
    age: 30
  },
  // Mumbai Users - FEMALE
  {
    id: `test-user-mumbai-female-1`,
    username: "Priya",
    gender: Gender.FEMALE,
    city: "Mumbai",
    status: UserStatus.AVAILABLE,
    brands: ["Nike", "Apple", "JBL", "Chanel"],
    interests: ["Music", "Travel", "Fitness"],
    values: ["Adventure", "Honesty", "Friendship", "Positivity"],
    music: { name: "Shape of You", artist: "Ed Sheeran" },
    intent: "Looking for meaningful connections",
    age: 24
  },
  {
    id: `test-user-mumbai-female-2`,
    username: "Ananya",
    gender: Gender.FEMALE,
    city: "Mumbai",
    status: UserStatus.AVAILABLE,
    brands: ["Adidas", "Samsung", "Puma"],
    interests: ["Cooking", "Reading", "Yoga"],
    values: ["Kindness", "Empathy", "Compassion"],
    music: { name: "Blinding Lights", artist: "The Weeknd" },
    intent: "Here to meet new people",
    age: 26
  },
  {
    id: `test-user-mumbai-female-3`,
    username: "Sneha",
    gender: Gender.FEMALE,
    city: "Mumbai",
    status: UserStatus.IN_BROADCAST_AVAILABLE,
    brands: ["Gucci", "Chanel", "Mercedes-Benz"],
    interests: ["Fashion", "Art", "Dancing"],
    values: ["Creativity", "Authenticity", "Balance"],
    music: { name: "Watermelon Sugar", artist: "Harry Styles" },
    intent: "Exploring new connections",
    age: 27
  },
  // Delhi Users - MALE
  {
    id: `test-user-delhi-male-1`,
    username: "Amit",
    gender: Gender.MALE,
    city: "Delhi",
    status: UserStatus.AVAILABLE,
    brands: ["Nike", "Apple"],
    interests: ["Sports", "Gaming"],
    values: ["Loyalty", "Respect"],
    music: { name: "Shape of You", artist: "Ed Sheeran" },
    intent: "Looking for friends",
    age: 23
  },
  {
    id: `test-user-delhi-male-2`,
    username: "Rohit",
    gender: Gender.MALE,
    city: "Delhi",
    status: UserStatus.AVAILABLE,
    brands: ["Adidas", "Samsung", "Sony", "Microsoft"],
    interests: ["Technology", "Gaming", "Movies", "Fitness"],
    values: ["Growth", "Ambition", "Excellence", "Optimism"],
    music: { name: "Blinding Lights", artist: "The Weeknd" },
    intent: "Here to meet new people",
    age: 29
  },
  // Delhi Users - FEMALE
  {
    id: `test-user-delhi-female-1`,
    username: "Kavya",
    gender: Gender.FEMALE,
    city: "Delhi",
    status: UserStatus.AVAILABLE,
    brands: ["Nike", "Apple", "JBL"],
    interests: ["Music", "Travel"],
    values: ["Adventure", "Honesty"],
    music: { name: "Shape of You", artist: "Ed Sheeran" },
    intent: "Looking for meaningful connections",
    age: 25
  },
  {
    id: `test-user-delhi-female-2`,
    username: "Meera",
    gender: Gender.FEMALE,
    city: "Delhi",
    status: UserStatus.AVAILABLE,
    brands: ["Chanel", "Gucci"],
    interests: ["Fashion", "Art", "Photography", "Dancing"],
    values: ["Creativity", "Authenticity", "Balance", "Positivity"],
    music: { name: "Watermelon Sugar", artist: "Harry Styles" },
    intent: "Exploring new connections",
    age: 28
  },
  // Bangalore Users - MALE
  {
    id: `test-user-bangalore-male-1`,
    username: "Karan",
    gender: Gender.MALE,
    city: "Bangalore",
    status: UserStatus.AVAILABLE,
    brands: ["Tesla", "BMW", "Google"],
    interests: ["Technology", "Cycling", "Nature"],
    values: ["Independence", "Freedom", "Growth"],
    music: { name: "Blinding Lights", artist: "The Weeknd" },
    intent: "Here to meet new people",
    age: 31
  },
  // Bangalore Users - FEMALE
  {
    id: `test-user-bangalore-female-1`,
    username: "Divya",
    gender: Gender.FEMALE,
    city: "Bangalore",
    status: UserStatus.AVAILABLE,
    brands: ["Apple", "Nike", "Bose"],
    interests: ["Music", "Fitness", "Yoga", "Reading"],
    values: ["Balance", "Kindness", "Empathy", "Compassion"],
    music: { name: "Shape of You", artist: "Ed Sheeran" },
    intent: "Looking for meaningful connections",
    age: 26
  },
  // NON_BINARY Users
  {
    id: `test-user-mumbai-nb-1`,
    username: "Alex",
    gender: Gender.NON_BINARY,
    city: "Mumbai",
    status: UserStatus.AVAILABLE,
    brands: ["Nike", "Apple"],
    interests: ["Art", "Music"],
    values: ["Authenticity", "Creativity"],
    music: { name: "Watermelon Sugar", artist: "Harry Styles" },
    intent: "Exploring new connections",
    age: 24
  },
  {
    id: `test-user-delhi-nb-1`,
    username: "Sam",
    gender: Gender.NON_BINARY,
    city: "Delhi",
    status: UserStatus.AVAILABLE,
    brands: ["Adidas", "Samsung"],
    interests: ["Technology", "Gaming"],
    values: ["Growth", "Freedom"],
    music: { name: "Blinding Lights", artist: "The Weeknd" },
    intent: "Here to meet new people",
    age: 27
  },
  // Anywhere Users (no preferredCity)
  {
    id: `test-user-anywhere-male-1`,
    username: "Global",
    gender: Gender.MALE,
    city: null,
    status: UserStatus.AVAILABLE,
    brands: ["Nike", "Apple", "JBL", "Sony"],
    interests: ["Travel", "Music", "Photography", "Adventure"],
    values: ["Adventure", "Freedom", "Independence", "Growth"],
    music: { name: "Shape of You", artist: "Ed Sheeran" },
    intent: "Traveling and meeting people",
    age: 29
  },
  {
    id: `test-user-anywhere-female-1`,
    username: "Wanderer",
    gender: Gender.FEMALE,
    city: null,
    status: UserStatus.AVAILABLE,
    brands: ["Adidas", "Chanel"],
    interests: ["Travel", "Art", "Photography"],
    values: ["Adventure", "Freedom", "Authenticity"],
    music: { name: "Watermelon Sugar", artist: "Harry Styles" },
    intent: "Exploring the world",
    age: 25
  },
  // Additional users for comprehensive testing
  // More Mumbai users for preference matching tests
  {
    id: `test-user-mumbai-male-4`,
    username: "Raj",
    gender: Gender.MALE,
    city: "Mumbai",
    status: UserStatus.AVAILABLE,
    brands: ["Nike", "Apple", "JBL"], // Same as Rahul for matching test
    interests: ["Music", "Sports", "Travel"], // Same as Rahul
    values: ["Adventure", "Honesty", "Friendship"], // Same as Rahul
    music: { name: "Shape of You", artist: "Ed Sheeran" }, // Same as Rahul
    intent: "Looking for meaningful connections",
    age: 26
  },
  {
    id: `test-user-mumbai-female-4`,
    username: "Riya",
    gender: Gender.FEMALE,
    city: "Mumbai",
    status: UserStatus.AVAILABLE,
    brands: ["Nike", "Apple", "JBL", "Chanel"], // Same as Priya
    interests: ["Music", "Travel", "Fitness"], // Same as Priya
    values: ["Adventure", "Honesty", "Friendship", "Positivity"], // Same as Priya
    music: { name: "Shape of You", artist: "Ed Sheeran" }, // Same as Priya
    intent: "Looking for meaningful connections",
    age: 23
  },
  // More users for gender filter testing
  {
    id: `test-user-mumbai-male-5`,
    username: "Suresh",
    gender: Gender.MALE,
    city: "Mumbai",
    status: UserStatus.AVAILABLE,
    brands: ["Adidas", "Samsung"],
    interests: ["Gaming", "Technology"],
    values: ["Growth", "Ambition"],
    music: { name: "Blinding Lights", artist: "The Weeknd" },
    intent: "Here to meet new people",
    age: 27
  },
  {
    id: `test-user-mumbai-female-5`,
    username: "Neha",
    gender: Gender.FEMALE,
    city: "Mumbai",
    status: UserStatus.AVAILABLE,
    brands: ["Adidas", "Samsung", "Puma"],
    interests: ["Cooking", "Reading"],
    values: ["Kindness", "Empathy"],
    music: { name: "Blinding Lights", artist: "The Weeknd" },
    intent: "Here to meet new people",
    age: 25
  },
  // More Delhi users
  {
    id: `test-user-delhi-male-3`,
    username: "Vishal",
    gender: Gender.MALE,
    city: "Delhi",
    status: UserStatus.IN_SQUAD_AVAILABLE,
    brands: ["Nike", "Apple"],
    interests: ["Sports", "Gaming"],
    values: ["Loyalty", "Respect"],
    music: { name: "Shape of You", artist: "Ed Sheeran" },
    intent: "Looking for friends",
    age: 24
  },
  {
    id: `test-user-delhi-female-3`,
    username: "Shreya",
    gender: Gender.FEMALE,
    city: "Delhi",
    status: UserStatus.IN_BROADCAST_AVAILABLE,
    brands: ["Nike", "Apple", "JBL"],
    interests: ["Music", "Travel"],
    values: ["Adventure", "Honesty"],
    music: { name: "Shape of You", artist: "Ed Sheeran" },
    intent: "Looking for meaningful connections",
    age: 24
  },
  // More Bangalore users
  {
    id: `test-user-bangalore-male-2`,
    username: "Ravi",
    gender: Gender.MALE,
    city: "Bangalore",
    status: UserStatus.AVAILABLE,
    brands: ["Tesla", "BMW", "Google"],
    interests: ["Technology", "Cycling"],
    values: ["Independence", "Freedom"],
    music: { name: "Blinding Lights", artist: "The Weeknd" },
    intent: "Here to meet new people",
    age: 32
  },
  {
    id: `test-user-bangalore-female-2`,
    username: "Pooja",
    gender: Gender.FEMALE,
    city: "Bangalore",
    status: UserStatus.AVAILABLE,
    brands: ["Apple", "Nike", "Bose"],
    interests: ["Music", "Fitness", "Yoga"],
    values: ["Balance", "Kindness", "Empathy"],
    music: { name: "Shape of You", artist: "Ed Sheeran" },
    intent: "Looking for meaningful connections",
    age: 27
  },
  // PREFER_NOT_TO_SAY gender users
  {
    id: `test-user-mumbai-pns-1`,
    username: "Taylor",
    gender: Gender.PREFER_NOT_TO_SAY,
    city: "Mumbai",
    status: UserStatus.AVAILABLE,
    brands: ["Nike", "Apple"],
    interests: ["Art", "Music"],
    values: ["Authenticity", "Creativity"],
    music: { name: "Watermelon Sugar", artist: "Harry Styles" },
    intent: "Exploring new connections",
    age: 25
  }
];

async function main() {
  console.log("🌱 Starting test user seed...");
  console.log(`📝 Creating ${testUsers.length} test users...\n`);

  // Get all brands, interests, values, and songs
  const brands = await prisma.brand.findMany();
  const interests = await prisma.interest.findMany();
  const values = await prisma.value.findMany();
  const songs = await prisma.song.findMany();

  // Create brand, interest, value, and song maps for quick lookup
  const brandMap = new Map(brands.map(b => [b.name, b]));
  const interestMap = new Map(interests.map(i => [i.name, i]));
  const valueMap = new Map(values.map(v => [v.name, v]));
  const songMap = new Map(songs.map(s => [`${s.name}|${s.artist}`, s]));

  let created = 0;
  let skipped = 0;

  for (const userData of testUsers) {
    try {
      // Check if user already exists
      const existing = await prisma.user.findUnique({
        where: { id: userData.id }
      });

      if (existing) {
        console.log(`⏭️  Skipping ${userData.id} (already exists)`);
        skipped++;
        continue;
      }

      // Calculate date of birth
      const today = new Date();
      const birthDate = new Date(today.getFullYear() - userData.age, 0, 1);

      // Get or create music preference
      let musicPreferenceId: string | null = null;
      if (userData.music) {
        const songKey = `${userData.music.name}|${userData.music.artist}`;
        let song = songMap.get(songKey);
        
        if (!song) {
          song = await prisma.song.create({
            data: {
              name: userData.music.name,
              artist: userData.music.artist
            }
          });
          songMap.set(songKey, song);
        }
        musicPreferenceId = song.id;
      }

      // Create user
      const user = await prisma.user.create({
        data: {
          id: userData.id,
          username: userData.username,
          dateOfBirth: birthDate,
          gender: userData.gender,
          genderChanged: userData.gender !== Gender.PREFER_NOT_TO_SAY,
          displayPictureUrl: `https://via.placeholder.com/400?text=${encodeURIComponent(userData.username)}`,
          preferredCity: userData.city,
          status: userData.status,
          intent: userData.intent,
          profileCompleted: true,
          musicPreferenceId: musicPreferenceId,
          photos: {
            create: [
              { url: `https://via.placeholder.com/400?text=${encodeURIComponent(userData.username)}-1`, order: 0 },
              { url: `https://via.placeholder.com/400?text=${encodeURIComponent(userData.username)}-2`, order: 1 },
              { url: `https://via.placeholder.com/400?text=${encodeURIComponent(userData.username)}-3`, order: 2 },
              { url: `https://via.placeholder.com/400?text=${encodeURIComponent(userData.username)}-4`, order: 3 }
            ]
          }
        }
      });

      // Add brand preferences
      if (userData.brands && userData.brands.length > 0) {
        const brandPreferences = userData.brands
          .map((brandName, index) => {
            const brand = brandMap.get(brandName);
            return brand ? { brandId: brand.id, order: index } : null;
          })
          .filter(Boolean) as Array<{ brandId: string; order: number }>;

        if (brandPreferences.length > 0) {
          await prisma.userBrand.createMany({
            data: brandPreferences.map(bp => ({
              userId: user.id,
              brandId: bp.brandId,
              order: bp.order
            }))
          });
        }
      }

      // Add interests
      if (userData.interests && userData.interests.length > 0) {
        const userInterests = userData.interests
          .map((interestName, index) => {
            const interest = interestMap.get(interestName);
            return interest ? { interestId: interest.id, order: index } : null;
          })
          .filter(Boolean) as Array<{ interestId: string; order: number }>;

        if (userInterests.length > 0) {
          await prisma.userInterest.createMany({
            data: userInterests.map(ui => ({
              userId: user.id,
              interestId: ui.interestId,
              order: ui.order
            }))
          });
        }
      }

      // Add values
      if (userData.values && userData.values.length > 0) {
        const userValues = userData.values
          .map((valueName, index) => {
            const value = valueMap.get(valueName);
            return value ? { valueId: value.id, order: index } : null;
          })
          .filter(Boolean) as Array<{ valueId: string; order: number }>;

        if (userValues.length > 0) {
          await prisma.userValue.createMany({
            data: userValues.map(uv => ({
              userId: user.id,
              valueId: uv.valueId,
              order: uv.order
            }))
          });
        }
      }

      console.log(`✅ Created ${userData.username} (${userData.gender}, ${userData.city || 'Anywhere'}, ${userData.status})`);
      created++;

    } catch (error) {
      console.error(`❌ Failed to create ${userData.id}:`, error);
    }
  }

  console.log(`\n🎉 Test user seed completed!`);
  console.log(`✅ Created: ${created}`);
  console.log(`⏭️  Skipped: ${skipped}`);
  console.log(`\n💡 These users can be discovered using your real token!`);
  console.log(`💡 User IDs start with 'test-user-' prefix`);
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

