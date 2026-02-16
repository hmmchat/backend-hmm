import { PrismaClient } from "../node_modules/.prisma/client/index.js";

const prisma = new PrismaClient();

const DEFAULT_LOADING_MEMES = [
  {
    text: "You can be an asshole. But what's the reason? why?",
    imageUrl: "https://cdn.hmmchat.live/memes/disaster-girl.jpg",
    category: "funny"
  },
  {
    text: "Waiting for someone to match your energy...",
    imageUrl: "https://cdn.hmmchat.live/memes/waiting.jpg",
    category: "relatable"
  },
  {
    text: "Delivering you a human now",
    imageUrl: "https://cdn.hmmchat.live/memes/delivery.jpg",
    category: "funny"
  }
];

async function main() {
  console.log("Seeding loading screen memes...");

  for (let i = 0; i < DEFAULT_LOADING_MEMES.length; i++) {
    const meme = DEFAULT_LOADING_MEMES[i];
    // Check if meme with same text already exists
    const existing = await (prisma as any).loadingScreenMeme.findFirst({
      where: { text: meme.text }
    });

    if (!existing) {
      await (prisma as any).loadingScreenMeme.create({
        data: {
          text: meme.text,
          imageUrl: meme.imageUrl,
          category: meme.category,
          isActive: true,
          order: i + 1
        }
      });
      console.log(`✅ Created meme: "${meme.text}"`);
    } else {
      console.log(`⏭️  Skipped (already exists): "${meme.text}"`);
    }
  }

  console.log(`✅ Seeding complete`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
