import { PrismaClient } from "../node_modules/.prisma/client/index.js";

const prisma = new PrismaClient();

const DEFAULT_ICEBREAKERS = [
  "What's your favorite movie of the year?",
  "What's the best book you've read recently?",
  "What's your go-to comfort food?",
  "What's your dream vacation destination?",
  "What's a skill you'd like to learn?",
  "What's your favorite way to spend a weekend?",
  "What's the most interesting place you've visited?",
  "What's a hobby you're passionate about?",
  "What's your favorite type of music?",
  "What's something on your bucket list?",
  "What's the best piece of advice you've received?",
  "What's your favorite season and why?",
  "What's a TV show you're currently watching?",
  "What's your favorite childhood memory?",
  "What's something that always makes you smile?",
  "What's your favorite way to exercise?",
  "What's a goal you're working towards?",
  "What's your favorite type of cuisine?",
  "What's something you're grateful for today?",
  "What's your favorite way to relax?",
  "What's the most adventurous thing you've done?",
  "What's your favorite holiday and why?",
  "What's a talent you have that surprises people?",
  "What's your favorite type of weather?",
  "What's something you've always wanted to try?",
  "What's your favorite way to start your day?",
  "What's a movie you could watch over and over?",
  "What's your favorite social media platform?",
  "What's something that motivates you?",
  "What's your favorite way to end your day?"
];

async function main() {
  console.log("Seeding icebreakers...");

  for (let i = 0; i < DEFAULT_ICEBREAKERS.length; i++) {
    await prisma.icebreaker.upsert({
      where: { id: `default-${i + 1}` },
      update: {
        question: DEFAULT_ICEBREAKERS[i],
        isActive: true
      },
      create: {
        id: `default-${i + 1}`,
        question: DEFAULT_ICEBREAKERS[i],
        isActive: true,
        order: i + 1
      }
    });
  }

  console.log(`✅ Seeded ${DEFAULT_ICEBREAKERS.length} icebreakers`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
