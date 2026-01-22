import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { ConversationSection } from "@prisma/client";
import { StreamingClientService } from "./streaming-client.service.js";

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly streamingClient: StreamingClientService
  ) {}

  /**
   * Get or create conversation between two users
   */
  async getOrCreateConversation(
    userId1: string,
    userId2: string
  ): Promise<{ id: string; section: ConversationSection }> {
    const [id1, id2] = [userId1, userId2].sort();

    // Try to find existing conversation
    let conversation = await this.prisma.conversation.findUnique({
      where: {
        userId1_userId2: {
          userId1: id1,
          userId2: id2
        }
      }
    });

    // If doesn't exist, create it
    if (!conversation) {
      conversation = await this.prisma.conversation.create({
        data: {
          userId1: id1,
          userId2: id2,
          section: ConversationSection.INBOX // Will be updated by determineSection
        }
      });
    }

    return {
      id: conversation.id,
      section: conversation.section
    };
  }

  /**
   * Determine conversation section based on message history and friendship status
   */
  async determineSection(
    userId1: string,
    userId2: string,
    areFriends: boolean
  ): Promise<ConversationSection> {
    // If friends, always in inbox
    if (areFriends) {
      return ConversationSection.INBOX;
    }

    // Check if both users have sent messages
    const [messagesFrom1, messagesFrom2] = await Promise.all([
      this.prisma.friendMessage.findFirst({
        where: {
          fromUserId: userId1,
          toUserId: userId2
        }
      }),
      this.prisma.friendMessage.findFirst({
        where: {
          fromUserId: userId2,
          toUserId: userId1
        }
      })
    ]);

    const hasMessagesFrom1 = messagesFrom1 !== null;
    const hasMessagesFrom2 = messagesFrom2 !== null;

    // Both have messages = two-sided conversation = INBOX
    if (hasMessagesFrom1 && hasMessagesFrom2) {
      return ConversationSection.INBOX;
    }

    // Only userId2 has sent messages = RECEIVED_REQUESTS (from userId1's perspective)
    if (hasMessagesFrom2 && !hasMessagesFrom1) {
      return ConversationSection.RECEIVED_REQUESTS;
    }

    // Only userId1 has sent messages = SENT_REQUESTS (from userId1's perspective)
    if (hasMessagesFrom1 && !hasMessagesFrom2) {
      return ConversationSection.SENT_REQUESTS;
    }

    // No messages yet - default to INBOX (will be updated when first message is sent)
    return ConversationSection.INBOX;
  }

  /**
   * Update conversation section and last message
   */
  async updateConversation(
    userId1: string,
    userId2: string,
    section: ConversationSection,
    lastMessageId: string
  ): Promise<void> {
    const [id1, id2] = [userId1, userId2].sort();

    await this.prisma.conversation.updateMany({
      where: {
        userId1: id1,
        userId2: id2
      },
      data: {
        section,
        lastMessageId,
        lastMessageAt: new Date()
      }
    });
  }

  /**
   * Get conversation by user IDs
   */
  async getConversation(userId1: string, userId2: string) {
    const [id1, id2] = [userId1, userId2].sort();

    return await this.prisma.conversation.findUnique({
      where: {
        userId1_userId2: {
          userId1: id1,
          userId2: id2
        }
      }
    });
  }

  /**
   * Get conversations for a user by section with last message and unread count
   * Note: Section is stored from userId1's perspective, so we need to reverse for userId2
   */
  async getConversationsBySection(
    userId: string,
    section: ConversationSection,
    limit: number = 50,
    cursor?: string
  ): Promise<{
    conversations: any[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    // Build where clause based on section and user perspective
    let whereClause: any;

    if (section === ConversationSection.INBOX) {
      // INBOX is the same for both users
      whereClause = {
        OR: [
          { userId1: userId, section: ConversationSection.INBOX },
          { userId2: userId, section: ConversationSection.INBOX }
        ]
      };
    } else if (section === ConversationSection.RECEIVED_REQUESTS) {
      // RECEIVED_REQUESTS: if user is userId1, they received from userId2
      // if user is userId2, they received from userId1 (stored as SENT_REQUESTS from userId1's perspective)
      whereClause = {
        OR: [
          { userId1: userId, section: ConversationSection.RECEIVED_REQUESTS },
          { userId2: userId, section: ConversationSection.SENT_REQUESTS }
        ]
      };
    } else {
      // SENT_REQUESTS: if user is userId1, they sent to userId2
      // if user is userId2, they sent to userId1 (stored as RECEIVED_REQUESTS from userId1's perspective)
      whereClause = {
        OR: [
          { userId1: userId, section: ConversationSection.SENT_REQUESTS },
          { userId2: userId, section: ConversationSection.RECEIVED_REQUESTS }
        ]
      };
    }

    const conversations = await this.prisma.conversation.findMany({
      where: whereClause,
      orderBy: {
        lastMessageAt: "desc"
      },
      take: limit + 1,
      ...(cursor && {
        cursor: { id: cursor },
        skip: 1
      })
    });

    const hasMore = conversations.length > limit;
    const resultConversations = hasMore ? conversations.slice(0, limit) : conversations;

    // Get last message and unread count for each conversation
    const conversationsWithDetails = await Promise.all(
      resultConversations.map(async (conv) => {
        const otherUserId = conv.userId1 === userId ? conv.userId2 : conv.userId1;

        // Get last message
        const lastMessage = conv.lastMessageId
          ? await this.prisma.friendMessage.findUnique({
              where: { id: conv.lastMessageId },
              select: {
                id: true,
                fromUserId: true,
                toUserId: true,
                message: true,
                messageType: true,
                giftId: true,
                giftAmount: true,
                createdAt: true
              }
            })
          : null;

        // Get unread count
        const unreadCount = await this.prisma.friendMessage.count({
          where: {
            fromUserId: otherUserId,
            toUserId: userId,
            isRead: false
          }
        });

        // Check if users are friends
        const [id1, id2] = [userId, otherUserId].sort();
        const friendship = await this.prisma.friend.findUnique({
          where: {
            userId1_userId2: {
              userId1: id1,
              userId2: id2
            }
          }
        });

        // Get user status and broadcast info
        const userStatus = await this.streamingClient.getUserStatus(otherUserId);

        return {
          id: conv.id,
          otherUserId,
          section: conv.section,
          lastMessage: lastMessage
            ? {
                id: lastMessage.id,
                fromUserId: lastMessage.fromUserId,
                message: lastMessage.message,
                messageType: lastMessage.messageType,
                giftId: lastMessage.giftId,
                giftAmount: lastMessage.giftAmount,
                createdAt: lastMessage.createdAt
              }
            : null,
          unreadCount,
          isFriend: friendship !== null,
          // User status and broadcast info
          userStatus: userStatus.status, // "online" | "offline" | "broadcasting"
          isBroadcasting: userStatus.isBroadcasting,
          broadcastRoomId: userStatus.roomId,
          broadcastUrl: userStatus.broadcastUrl, // Deep link URL for broadcast
          lastMessageAt: conv.lastMessageAt,
          createdAt: conv.createdAt
        };
      })
    );

    const nextCursor = hasMore ? resultConversations[resultConversations.length - 1].id : undefined;

    return {
      conversations: conversationsWithDetails,
      nextCursor,
      hasMore
    };
  }

  /**
   * Promote conversation to inbox (when it becomes two-sided)
   */
  async promoteToInbox(userId1: string, userId2: string): Promise<void> {
    const [id1, id2] = [userId1, userId2].sort();

    await this.prisma.conversation.updateMany({
      where: {
        userId1: id1,
        userId2: id2,
        section: {
          in: [ConversationSection.RECEIVED_REQUESTS, ConversationSection.SENT_REQUESTS]
        }
      },
      data: {
        section: ConversationSection.INBOX
      }
    });

    this.logger.log(`Conversation between ${userId1} and ${userId2} promoted to INBOX`);
  }
}
