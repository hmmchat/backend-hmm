import { PrismaClient, ConversationSection } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Migration script to create Conversation records from existing FriendMessage data
 * This should be run after the schema migration
 */
async function main() {
  console.log("Starting conversation migration...");

  // Get all unique user pairs from messages
  const messages = await prisma.friendMessage.findMany({
    select: {
      fromUserId: true,
      toUserId: true,
      createdAt: true,
      id: true
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  // Group messages by user pair
  const userPairs = new Map<string, {
    userId1: string;
    userId2: string;
    messages: Array<{ fromUserId: string; toUserId: string; createdAt: Date; id: string }>;
    lastMessageId: string;
    lastMessageAt: Date;
  }>();

  for (const msg of messages) {
    const [id1, id2] = [msg.fromUserId, msg.toUserId].sort();
    const key = `${id1}:${id2}`;

    if (!userPairs.has(key)) {
      userPairs.set(key, {
        userId1: id1,
        userId2: id2,
        messages: [],
        lastMessageId: msg.id,
        lastMessageAt: msg.createdAt
      });
    }

    const pair = userPairs.get(key)!;
    pair.messages.push(msg);

    // Update last message if this is newer
    if (msg.createdAt > pair.lastMessageAt) {
      pair.lastMessageId = msg.id;
      pair.lastMessageAt = msg.createdAt;
    }
  }

  console.log(`Found ${userPairs.size} unique user pairs with messages`);

  let created = 0;
  let updated = 0;

  for (const [key, pair] of userPairs.entries()) {
    // Check if users are friends
    const friendship = await prisma.friend.findUnique({
      where: {
        userId1_userId2: {
          userId1: pair.userId1,
          userId2: pair.userId2
        }
      }
    });

    const areFriends = friendship !== null;

    // Determine section
    let section: ConversationSection = ConversationSection.INBOX;

    if (!areFriends) {
      // Check if both users have sent messages
      const hasMessagesFrom1 = pair.messages.some(m => m.fromUserId === pair.userId1);
      const hasMessagesFrom2 = pair.messages.some(m => m.fromUserId === pair.userId2);

      if (hasMessagesFrom1 && hasMessagesFrom2) {
        section = ConversationSection.INBOX; // Two-sided conversation
      } else if (hasMessagesFrom2 && !hasMessagesFrom1) {
        // From userId1's perspective: received requests
        section = ConversationSection.RECEIVED_REQUESTS;
      } else if (hasMessagesFrom1 && !hasMessagesFrom2) {
        // From userId1's perspective: sent requests
        section = ConversationSection.SENT_REQUESTS;
      }
    }

    // Create or update conversation
    try {
      await prisma.conversation.upsert({
        where: {
          userId1_userId2: {
            userId1: pair.userId1,
            userId2: pair.userId2
          }
        },
        create: {
          userId1: pair.userId1,
          userId2: pair.userId2,
          section,
          lastMessageId: pair.lastMessageId,
          lastMessageAt: pair.lastMessageAt
        },
        update: {
          section,
          lastMessageId: pair.lastMessageId,
          lastMessageAt: pair.lastMessageAt
        }
      });

      created++;
    } catch (error: any) {
      if (error.code === "P2002") {
        // Already exists, update it
        await prisma.conversation.updateMany({
          where: {
            userId1: pair.userId1,
            userId2: pair.userId2
          },
          data: {
            section,
            lastMessageId: pair.lastMessageId,
            lastMessageAt: pair.lastMessageAt
          }
        });
        updated++;
      } else {
        console.error(`Error creating conversation for ${key}:`, error.message);
      }
    }
  }

  console.log(`Migration complete! Created: ${created}, Updated: ${updated}`);
}

main()
  .catch((e) => {
    console.error("Migration error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
