import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { ConversationSection, MessageType } from "../../node_modules/.prisma/client/index.js";
import { StreamingClientService } from "./streaming-client.service.js";
import { UserClientService } from "./user-client.service.js";

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly streamingClient: StreamingClientService,
    private readonly userClient: UserClientService
  ) { }

  /**
   * Inbound unread count: messages from peer to viewer.
   * Strict rule: unread means incoming messages not marked read yet.
   */
  async countIncomingUnreadFromPeer(
    peerUserId: string,
    viewerUserId: string
  ): Promise<number> {
    return this.prisma.friendMessage.count({
      where: {
        fromUserId: peerUserId,
        toUserId: viewerUserId,
        isRead: false
      }
    });
  }

  /** Peer user IDs the given user has a friendship row with (sorted-pair Friend table). */
  private async getFriendPeerIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.friend.findMany({
      where: {
        OR: [{ userId1: userId }, { userId2: userId }]
      },
      select: { userId1: true, userId2: true }
    });
    const ids = rows.map((f) => (f.userId1 === userId ? f.userId2 : f.userId1));
    if (ids.length === 0) return [];
    const { validIds } = await this.userClient.validateUserIds(ids);
    return validIds;
  }

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
   * 
   * Filter options:
   * - text_only: Only conversations with TEXT messages (filtered at DB level)
   * - with_gift: Only conversations with GIFT or GIFT_WITH_MESSAGE (filtered at DB level)
   * - only_follows: Only friend requests without messages (optimized single query)
   */
  async getConversationsBySection(
    userId: string,
    section: ConversationSection,
    limit: number = 50,
    cursor?: string,
    filter?: "text_only" | "with_gift" | "only_follows"
  ): Promise<{
    conversations: any[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    // Handle only_follows filter separately (friend requests without messages)
    if (filter === "only_follows") {
      if (section === ConversationSection.INBOX) {
        return await this.getInboxNonFriendsOnly(userId, limit, cursor);
      }
      return await this.getOnlyFollowsConversations(userId, section, limit, cursor);
    }

    // Build where clause based on section and user perspective
    let whereClause: any;

    if (section === ConversationSection.INBOX) {
      // Inbox listing is special:
      // - Friends should appear even if the Conversation.section was never updated (e.g. crossed FR -> friends).
      // - Non-friends should only appear in inbox when there's a real message thread (avoid ghost rows).
      const friendIds = await this.getFriendPeerIds(userId);
      const friendPairOr =
        friendIds.length > 0
          ? ([
            { userId1: userId, userId2: { in: friendIds } },
            { userId2: userId, userId1: { in: friendIds } }
          ] as any[])
          : ([] as any[]);

      whereClause = {
        AND: [
          { OR: [{ userId1: userId }, { userId2: userId }] },
          {
            OR: [
              ...friendPairOr,
              {
                AND: [
                  {
                    OR: [
                      { userId1: userId, section: ConversationSection.INBOX },
                      { userId2: userId, section: ConversationSection.INBOX }
                    ]
                  },
                  { lastMessageId: { not: null } }
                ]
              }
            ]
          }
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

    /*
     * Listing rules (conversation rows only; empty friend-request-only rows use only_follows + synthetic IDs):
     * - INBOX: show friends even with no messages; show non-friends only if at least one message exists
     *   (promoted two-sided threads). Hide ghost rows created by getOrCreateConversation with no messages.
     * - RECEIVED / SENT: only rows with a real last message (one-sided paid/gift threads). Empty FR-only
     *   bubbles come from GET .../requests/pending|sent + frontend, not from Conversation with null lastMessage.
     */
    if (filter !== "text_only" && filter !== "with_gift") {
      if (section === ConversationSection.INBOX) {
        // (Handled in the INBOX whereClause above.)
      } else {
        whereClause = {
          AND: [whereClause, { lastMessageId: { not: null } }]
        };
      }
    }

    // Note: Conversations with lastMessage: null are automatically excluded from
    // text_only and with_gift filters since these filters require a lastMessage to check messageType.
    // Apply message type filter at database level if specified
    if (filter === "text_only" || filter === "with_gift") {
      // Since Prisma doesn't support filtering on related fields in WHERE easily,
      // we'll fetch conversations and then filter by checking lastMessage.messageType
      // But we'll optimize by fetching lastMessage in the same query using include
      // Use composite sorting: lastMessageAt primary, createdAt fallback
      // This ensures consistent ordering even after in-memory filtering
      const conversations = await this.prisma.conversation.findMany({
        where: {
          ...whereClause,
          lastMessageId: { not: null } // Must have a last message
        },
        orderBy: [
          { lastMessageAt: "desc" },
          { createdAt: "desc" }
        ],
        take: limit * 2, // Fetch more to account for filtering
        ...(cursor && {
          cursor: { id: cursor },
          skip: 1
        })
      });

      // Fetch last messages for all conversations in parallel
      const lastMessageIds = conversations
        .map(c => c.lastMessageId)
        .filter((id): id is string => id !== null);

      const lastMessages = await this.prisma.friendMessage.findMany({
        where: {
          id: { in: lastMessageIds }
        },
        select: {
          id: true,
          fromUserId: true,
          toUserId: true,
          message: true,
          messageType: true,
          giftId: true,
          giftAmount: true,
          squadMeta: true,
          createdAt: true
        }
      });

      const lastMessageMap = new Map(lastMessages.map(m => [m.id, m]));

      // Filter conversations by message type
      // Edge case: Handle conversations where lastMessageId is stale or message was deleted
      const filteredConversations = conversations.filter(conv => {
        if (!conv.lastMessageId) return false;

        // If lastMessageId exists but message not found, try to get actual last message
        let lastMessage = lastMessageMap.get(conv.lastMessageId);
        if (!lastMessage) {
          // Message was deleted, this conversation shouldn't match any filter
          // (it will be handled by the stale message update above)
          return false;
        }

        if (filter === "text_only") {
          return lastMessage.messageType === MessageType.TEXT;
        } else if (filter === "with_gift") {
          return lastMessage.messageType === MessageType.GIFT ||
            lastMessage.messageType === MessageType.GIFT_WITH_MESSAGE;
        }
        return true;
      });

      // After filtering, explicitly re-sort to ensure order is maintained
      // This guarantees conversations remain sorted by latest message (newest first)
      const sortedFilteredConversations = filteredConversations.sort((a, b) => {
        const timeA = a.lastMessageAt?.getTime() ?? a.createdAt.getTime();
        const timeB = b.lastMessageAt?.getTime() ?? b.createdAt.getTime();
        return timeB - timeA; // Descending order (newest first)
      });

      // Take only the requested limit
      const hasMore = sortedFilteredConversations.length > limit;
      const resultConversations = hasMore ? sortedFilteredConversations.slice(0, limit) : sortedFilteredConversations;

      // Get details for filtered conversations
      const conversationsWithDetails = await this.getConversationDetails(
        userId,
        resultConversations,
        lastMessageMap
      );

      const nextCursor = hasMore ? resultConversations[resultConversations.length - 1].id : undefined;

      return {
        conversations: conversationsWithDetails,
        nextCursor,
        hasMore
      };
    }

    // No filter - standard query
    // Ensure friends appear in Inbox even with no messages by guaranteeing a Conversation row exists.
    // (Friend requests can be accepted without ever creating a conversation row.)
    if (section === ConversationSection.INBOX) {
      const friendIds = await this.getFriendPeerIds(userId);
      if (friendIds.length > 0) {
        const data = friendIds.map((otherUserId) => {
          const [id1, id2] = [userId, otherUserId].sort();
          return {
            userId1: id1,
            userId2: id2,
            section: ConversationSection.INBOX
          };
        });
        await this.prisma.conversation.createMany({
          data,
          skipDuplicates: true
        });
      }
    }

    // Use composite sorting: lastMessageAt primary, createdAt fallback
    // This ensures conversations with messages are sorted by lastMessageAt (newest first)
    // and conversations without messages are sorted by createdAt (newest first)
    const conversations = await this.prisma.conversation.findMany({
      where: whereClause,
      orderBy: [
        { lastMessageAt: "desc" },
        { createdAt: "desc" }
      ],
      take: limit + 1,
      ...(cursor && {
        cursor: { id: cursor },
        skip: 1
      })
    });

    const hasMore = conversations.length > limit;
    const resultConversations = hasMore ? conversations.slice(0, limit) : conversations;

    // Fetch last messages in batch
    // Edge case: Handle stale lastMessageId (message might have been deleted)
    const lastMessageIds = resultConversations
      .map(c => c.lastMessageId)
      .filter((id): id is string => id !== null);

    const lastMessages = lastMessageIds.length > 0
      ? await this.prisma.friendMessage.findMany({
        where: { id: { in: lastMessageIds } },
        select: {
          id: true,
          fromUserId: true,
          toUserId: true,
          message: true,
          messageType: true,
          giftId: true,
          giftAmount: true,
          squadMeta: true,
          createdAt: true
        }
      })
      : [];

    const lastMessageMap = new Map(lastMessages.map(m => [m.id, m]));

    // Edge case: If lastMessageId exists but message was deleted, fetch the actual last message
    const conversationsWithStaleLastMessage = resultConversations.filter(
      conv => conv.lastMessageId && !lastMessageMap.has(conv.lastMessageId)
    );

    if (conversationsWithStaleLastMessage.length > 0) {
      // Fetch actual last messages for conversations with stale lastMessageId
      const actualLastMessages = await Promise.all(
        conversationsWithStaleLastMessage.map(async (conv) => {
          const otherUserId = conv.userId1 === userId ? conv.userId2 : conv.userId1;
          const [id1, id2] = [userId, otherUserId].sort();

          return this.prisma.friendMessage.findFirst({
            where: {
              OR: [
                { fromUserId: id1, toUserId: id2 },
                { fromUserId: id2, toUserId: id1 }
              ]
            },
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              fromUserId: true,
              toUserId: true,
              message: true,
              messageType: true,
              giftId: true,
              giftAmount: true,
              squadMeta: true,
              createdAt: true
            }
          });
        })
      );

      // Update lastMessageMap and conversation lastMessageId
      actualLastMessages.forEach((msg, index) => {
        if (msg) {
          lastMessageMap.set(msg.id, msg);
          // Update conversation's lastMessageId if it changed
          const conv = conversationsWithStaleLastMessage[index];
          if (conv.lastMessageId !== msg.id) {
            conv.lastMessageId = msg.id;
            // Optionally update in DB (async, don't wait)
            this.prisma.conversation.updateMany({
              where: { id: conv.id },
              data: { lastMessageId: msg.id, lastMessageAt: msg.createdAt }
            }).catch(err => {
              this.logger.warn(`Failed to update stale lastMessageId for conversation ${conv.id}: ${err.message}`);
            });
          }
        }
      });
    }

    // Get details for conversations
    const conversationsWithDetails = await this.getConversationDetails(
      userId,
      resultConversations,
      lastMessageMap
    );

    const nextCursor = hasMore ? resultConversations[resultConversations.length - 1].id : undefined;

    return {
      conversations: conversationsWithDetails,
      nextCursor,
      hasMore
    };
  }

  /**
   * Helper method to get conversation details (unread count, friendship, user status)
   * Optimized to batch queries
   */
  private async getConversationDetails(
    userId: string,
    conversations: any[],
    lastMessageMap: Map<string, any>
  ): Promise<any[]> {
    if (conversations.length === 0) {
      return [];
    }

    // Get all other user IDs
    const otherUserIds = conversations.map(conv =>
      conv.userId1 === userId ? conv.userId2 : conv.userId1
    );
    const uniqueOtherUserIds = [...new Set(otherUserIds)];

    // Batch fetch friendships
    const friendshipPairs: Array<{ id1: string; id2: string }> = uniqueOtherUserIds.map(otherUserId => {
      const [id1, id2] = [userId, otherUserId].sort();
      return { id1, id2 };
    });

    const id1s = friendshipPairs.map(p => p.id1);
    const id2s = friendshipPairs.map(p => p.id2);

    const friendships = await this.prisma.friend.findMany({
      where: {
        OR: id1s.map((id1, i) => ({
          userId1: id1,
          userId2: id2s[i]
        }))
      }
    });

    const friendshipSet = new Set(
      friendships.map(f => `${f.userId1}_${f.userId2}`)
    );

    // Batch fetch unread counts (read cursor + legacy isRead when cursor unset)
    const unreadCounts = await Promise.all(
      conversations.map(async (conv) => {
        const otherUserId = conv.userId1 === userId ? conv.userId2 : conv.userId1;
        return {
          conversationId: conv.id,
          count: await this.countIncomingUnreadFromPeer(otherUserId, userId)
        };
      })
    );

    const unreadCountMap = new Map(
      unreadCounts.map(uc => [uc.conversationId, uc.count])
    );

    // Drop hard-deleted / missing peers (dashboard purge) so they never show as "Unknown User".
    const { validIds } = await this.userClient.validateUserIds(uniqueOtherUserIds);
    const validPeerSet = new Set(validIds);
    const livePeerIds = uniqueOtherUserIds.filter((id) => validPeerSet.has(id));

    const [userStatusMap, fullProfiles] = await Promise.all([
      this.streamingClient.getUserStatuses(livePeerIds),
      Promise.all(livePeerIds.map((id) => this.userClient.getUserProfile(id)))
    ]);
    const profileMap = new Map(
      livePeerIds.map((id, i) => [id, fullProfiles[i]])
    );
    const missingPeerSet = new Set(
      livePeerIds.filter((_, i) => fullProfiles[i]?.missing)
    );

    // Build response — skip conversations whose other user no longer exists
    return conversations
      .filter((conv) => {
        const otherUserId = conv.userId1 === userId ? conv.userId2 : conv.userId1;
        return validPeerSet.has(otherUserId) && !missingPeerSet.has(otherUserId);
      })
      .map((conv) => {
        const otherUserId = conv.userId1 === userId ? conv.userId2 : conv.userId1;
        const [id1, id2] = [userId, otherUserId].sort();
        const isFriend = friendshipSet.has(`${id1}_${id2}`);
        const lastMessage = conv.lastMessageId
          ? lastMessageMap.get(conv.lastMessageId)
          : null;
        const userStatus = userStatusMap.get(otherUserId) || {
          status: "offline",
          isBroadcasting: false,
          roomId: null,
          broadcastUrl: null
        };
        const profile = profileMap.get(otherUserId) || {
          username: null,
          displayPictureUrl: null
        };

        return {
          id: conv.id,
          conversationId: conv.id, // Support both formats
          otherUserId,
          otherUser: {
            id: otherUserId,
            username: profile.username || "User",
            displayPictureUrl: profile.displayPictureUrl || null
          },
          section: conv.section,
          lastMessage: lastMessage
            ? {
              id: lastMessage.id,
              fromUserId: lastMessage.fromUserId,
              message: lastMessage.message,
              messageType: lastMessage.messageType,
              giftId: lastMessage.giftId,
              giftAmount: lastMessage.giftAmount,
              squadMeta: lastMessage.squadMeta ?? null,
              createdAt: lastMessage.createdAt
            }
            : null,
          unreadCount: unreadCountMap.get(conv.id) || 0,
          isFriend,
          userStatus: userStatus.status,
          isBroadcasting: userStatus.isBroadcasting,
          broadcastRoomId: userStatus.roomId,
          broadcastUrl: userStatus.broadcastUrl,
          lastMessageAt: conv.lastMessageAt,
          createdAt: conv.createdAt
        };
      });
  }

  /**
   * Inbox threads where the other user is not a friend (for "only_follows"-style filter on inbox).
   */
  private async getInboxNonFriendsOnly(
    userId: string,
    limit: number,
    cursor?: string
  ): Promise<{
    conversations: any[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    const take = Math.min(100, Math.max(limit * 4, limit));
    const expanded = await this.getConversationsBySection(
      userId,
      ConversationSection.INBOX,
      take,
      cursor,
      undefined
    );
    const nonFriends = expanded.conversations.filter((c) => !c.isFriend);
    const slice = nonFriends.slice(0, limit);
    const hasMore = nonFriends.length > limit || expanded.hasMore;
    return {
      conversations: slice,
      nextCursor: hasMore && slice.length > 0 ? slice[slice.length - 1].id : undefined,
      hasMore
    };
  }

  /**
   * Get only friend requests without messages (only_follows filter)
   * Optimized with a single query using Prisma for better performance
   */
  private async getOnlyFollowsConversations(
    userId: string,
    section: ConversationSection,
    limit: number = 50,
    cursor?: string
  ): Promise<{
    conversations: any[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    // Determine friend request direction based on section
    const friendRequestWhere: any = {
      status: "PENDING",
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } }
      ]
    };

    if (section === ConversationSection.RECEIVED_REQUESTS) {
      friendRequestWhere.toUserId = userId;
    } else {
      friendRequestWhere.fromUserId = userId;
    }

    // Add cursor for pagination
    // Handle cursor format: if it's "follow_{requestId}", extract the requestId
    if (cursor) {
      const requestId = cursor.startsWith("follow_") ? cursor.replace("follow_", "") : cursor;
      friendRequestWhere.id = { lt: requestId };
    }

    // Get pending friend requests with pagination
    // Note: We sort by createdAt (not lastMessageAt) because these are friend requests
    // without messages - they don't have a lastMessageAt value
    const friendRequests = await this.prisma.friendRequest.findMany({
      where: friendRequestWhere,
      orderBy: {
        createdAt: "desc"
      },
      take: limit + 1
    });

    const hasMore = friendRequests.length > limit;
    const resultRequests = hasMore ? friendRequests.slice(0, limit) : friendRequests;

    if (resultRequests.length === 0) {
      return {
        conversations: [],
        nextCursor: undefined,
        hasMore: false
      };
    }

    // Get all user pairs to check for messages
    const userPairs = resultRequests.map(request => {
      const otherUserId = section === ConversationSection.RECEIVED_REQUESTS
        ? request.fromUserId
        : request.toUserId;
      return {
        request,
        otherUserId,
        id1: [userId, otherUserId].sort()[0],
        id2: [userId, otherUserId].sort()[1]
      };
    });

    // Batch check for messages - use a single query to get all message counts
    const messageCountQueries = userPairs.map(({ id1, id2 }) =>
      this.prisma.friendMessage.count({
        where: {
          OR: [
            { fromUserId: id1, toUserId: id2 },
            { fromUserId: id2, toUserId: id1 }
          ]
        }
      })
    );

    const messageCounts = await Promise.all(messageCountQueries);

    // Filter out requests that have messages
    const requestsWithoutMessages = userPairs
      .map((pair, index) => ({
        ...pair,
        hasMessages: messageCounts[index] > 0
      }))
      .filter(pair => !pair.hasMessages);

    if (requestsWithoutMessages.length === 0) {
      return {
        conversations: [],
        nextCursor: hasMore ? resultRequests[resultRequests.length - 1].id : undefined,
        hasMore: false
      };
    }

    // Get unique other user IDs — omit hard-deleted peers
    const uniqueOtherUserIds = [...new Set(requestsWithoutMessages.map(r => r.otherUserId))];
    const { validIds: validFollowPeerIds } =
      await this.userClient.validateUserIds(uniqueOtherUserIds);
    const validFollowPeerSet = new Set(validFollowPeerIds);
    const liveFollowRequests = requestsWithoutMessages.filter((r) =>
      validFollowPeerSet.has(r.otherUserId)
    );
    const liveFollowPeerIds = [...new Set(liveFollowRequests.map((r) => r.otherUserId))];

    if (liveFollowRequests.length === 0) {
      return {
        conversations: [],
        nextCursor: hasMore ? `follow_${resultRequests[resultRequests.length - 1].id}` : undefined,
        hasMore
      };
    }

    // Batch fetch friendships - use a single query with OR conditions
    const friendshipPairs = liveFollowRequests.map(({ id1, id2 }) => ({ id1, id2 }));
    const uniquePairs = Array.from(
      new Map(friendshipPairs.map(p => [`${p.id1}_${p.id2}`, p])).values()
    );

    const friendshipQueries = uniquePairs.map(({ id1, id2 }) =>
      this.prisma.friend.findUnique({
        where: {
          userId1_userId2: {
            userId1: id1,
            userId2: id2
          }
        }
      })
    );

    const friendships = await Promise.all(friendshipQueries);
    const friendshipMap = new Map(
      uniquePairs.map((pair, i) => [
        `${pair.id1}_${pair.id2}`,
        friendships[i] !== null
      ])
    );

    const userStatusMap = await this.streamingClient
      .getUserStatuses(liveFollowPeerIds)
      .catch(() => new Map());

    // Build conversation-like objects with consistent structure
    const conversations = liveFollowRequests.map(({ request, otherUserId, id1, id2 }) => {
      const userStatus = userStatusMap.get(otherUserId) || {
        status: "offline" as const,
        isBroadcasting: false,
        roomId: null,
        broadcastUrl: null
      };
      const isFriend = friendshipMap.get(`${id1}_${id2}`) || false;

      return {
        id: `follow_${request.id}`, // Consistent ID format for frontend
        conversationId: `follow_${request.id}`,
        otherUserId,
        section,
        lastMessage: null, // No messages for follow requests
        unreadCount: 0,
        isFriend,
        userStatus: userStatus.status,
        isBroadcasting: userStatus.isBroadcasting,
        broadcastRoomId: userStatus.roomId,
        broadcastUrl: userStatus.broadcastUrl,
        lastMessageAt: request.createdAt,
        createdAt: request.createdAt,
        isFollowRequest: true, // Flag to indicate this is a follow request
        followRequestId: request.id // Include original request ID for reference
      };
    });

    // Format nextCursor as "follow_{requestId}" for consistency with conversation.id format
    const nextCursor = hasMore ? `follow_${resultRequests[resultRequests.length - 1].id}` : undefined;

    return {
      conversations,
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

  /** Viewer-facing section for a stored conversation row. Friends always map to INBOX. */
  private viewerSectionForConversation(
    userId: string,
    conv: { userId1: string; userId2: string; section: ConversationSection },
    isFriend: boolean
  ): ConversationSection {
    if (isFriend) return ConversationSection.INBOX;
    if (conv.userId1 === userId) return conv.section;
    if (conv.section === ConversationSection.RECEIVED_REQUESTS) {
      return ConversationSection.SENT_REQUESTS;
    }
    if (conv.section === ConversationSection.SENT_REQUESTS) {
      return ConversationSection.RECEIVED_REQUESTS;
    }
    return ConversationSection.INBOX;
  }

  private buildMatchSnippet(text: string, query: string, radius = 40): string {
    const raw = String(text || "");
    const lower = raw.toLowerCase();
    const q = query.toLowerCase();
    const idx = lower.indexOf(q);
    if (idx < 0) {
      return raw.length > 80 ? `${raw.slice(0, 80)}…` : raw;
    }
    const start = Math.max(0, idx - radius);
    const end = Math.min(raw.length, idx + q.length + radius);
    return `${start > 0 ? "…" : ""}${raw.slice(start, end)}${end < raw.length ? "…" : ""}`;
  }

  /**
   * Search conversations across inbox / received / sent by display name and message text.
   * Returns one row per conversation for the requested section, plus match counts for all sections.
   */
  async searchConversations(
    userId: string,
    query: string,
    section: ConversationSection,
    limit: number = 20,
    cursor?: string,
    filter?: "text_only" | "with_gift" | "only_follows"
  ): Promise<{
    conversations: any[];
    nextCursor?: string;
    hasMore: boolean;
    sectionCounts: {
      inbox: number;
      received: number;
      sent: number;
    };
  }> {
    const q = (query || "").trim();
    const emptyCounts = { inbox: 0, received: 0, sent: 0 };
    if (q.length < 3) {
      return { conversations: [], nextCursor: undefined, hasMore: false, sectionCounts: emptyCounts };
    }

    const offset = Math.max(0, parseInt(cursor || "0", 10) || 0);
    const MESSAGE_MATCH_CAP = 500;

    // Peers from conversations + pending friend requests
    const [allConversations, friendIds, pendingReceived, pendingSent] = await Promise.all([
      this.prisma.conversation.findMany({
        where: {
          OR: [{ userId1: userId }, { userId2: userId }]
        },
        select: {
          id: true,
          userId1: true,
          userId2: true,
          section: true,
          lastMessageAt: true,
          lastMessageId: true,
          createdAt: true
        }
      }),
      this.getFriendPeerIds(userId),
      this.prisma.friendRequest.findMany({
        where: {
          toUserId: userId,
          status: "PENDING",
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
        },
        select: { id: true, fromUserId: true, createdAt: true }
      }),
      this.prisma.friendRequest.findMany({
        where: {
          fromUserId: userId,
          status: "PENDING",
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
        },
        select: { id: true, toUserId: true, createdAt: true }
      })
    ]);

    const friendSet = new Set(friendIds);
    const peerIdSet = new Set<string>();
    for (const conv of allConversations) {
      peerIdSet.add(conv.userId1 === userId ? conv.userId2 : conv.userId1);
    }
    for (const r of pendingReceived) peerIdSet.add(r.fromUserId);
    for (const r of pendingSent) peerIdSet.add(r.toUserId);

    const [nameMatches, messageHits] = await Promise.all([
      this.userClient.matchUsernamesAmongIds([...peerIdSet], q),
      this.prisma.friendMessage.findMany({
        where: {
          AND: [
            { OR: [{ fromUserId: userId }, { toUserId: userId }] },
            { message: { contains: q, mode: "insensitive" } }
          ]
        },
        orderBy: { createdAt: "desc" },
        take: MESSAGE_MATCH_CAP,
        select: {
          id: true,
          fromUserId: true,
          toUserId: true,
          message: true,
          messageType: true,
          giftId: true,
          giftAmount: true,
          squadMeta: true,
          createdAt: true
        }
      })
    ]);

    const nameMatchIds = new Set(nameMatches.map((u) => u.id));
    const profileFromName = new Map<
      string,
      { id?: string; username: string | null; displayPictureUrl: string | null }
    >(nameMatches.map((u) => [u.id, u]));

    // Latest matching message per peer
    const messageMatchByPeer = new Map<
      string,
      {
        id: string;
        fromUserId: string;
        toUserId: string;
        message: string | null;
        messageType: MessageType;
        giftId: string | null;
        giftAmount: number | null;
        squadMeta: string | null;
        createdAt: Date;
      }
    >();
    for (const msg of messageHits) {
      const peer = msg.fromUserId === userId ? msg.toUserId : msg.fromUserId;
      if (!messageMatchByPeer.has(peer)) {
        messageMatchByPeer.set(peer, msg);
      }
    }

    type Hit = {
      peerId: string;
      viewerSection: ConversationSection;
      matchKind: "name" | "message";
      matchSnippet?: string;
      conversation?: (typeof allConversations)[number];
      pendingRequest?: {
        id: string;
        createdAt: Date;
        direction: "received" | "sent";
      };
      activityAt: number;
    };

    const hitsByPeer = new Map<string, Hit>();

    const upsertHit = (hit: Hit) => {
      const existing = hitsByPeer.get(hit.peerId);
      if (!existing) {
        hitsByPeer.set(hit.peerId, hit);
        return;
      }
      // Prefer name match; keep richer conversation row over synthetic FR
      const preferName =
        hit.matchKind === "name" && existing.matchKind === "message";
      const preferConv =
        hit.conversation && !existing.conversation;
      if (preferName || preferConv) {
        hitsByPeer.set(hit.peerId, {
          ...hit,
          matchKind: preferName || existing.matchKind === "name" ? "name" : hit.matchKind,
          matchSnippet:
            hit.matchKind === "name"
              ? existing.matchSnippet
              : hit.matchSnippet || existing.matchSnippet,
          activityAt: Math.max(hit.activityAt, existing.activityAt)
        });
        if (preferName && existing.matchSnippet && hit.matchKind === "name") {
          // keep message snippet if we also had a message match, for preview? Spec: name first; preview can stay last message from details
        }
        return;
      }
      if (hit.activityAt > existing.activityAt) {
        hitsByPeer.set(hit.peerId, {
          ...existing,
          activityAt: hit.activityAt,
          matchSnippet: existing.matchSnippet || hit.matchSnippet
        });
      }
    };

    const convByPeer = new Map<string, (typeof allConversations)[number]>();
    for (const conv of allConversations) {
      const peer = conv.userId1 === userId ? conv.userId2 : conv.userId1;
      convByPeer.set(peer, conv);
    }

    const pendingRecvByPeer = new Map(pendingReceived.map((r) => [r.fromUserId, r]));
    const pendingSentByPeer = new Map(pendingSent.map((r) => [r.toUserId, r]));

    // Name matches → conversation row when listable; else pending FR synthetic
    for (const peerId of nameMatchIds) {
      const conv = convByPeer.get(peerId);
      const isFriend = friendSet.has(peerId);

      if (conv) {
        const viewerSection = this.viewerSectionForConversation(userId, conv, isFriend);
        const listableInbox =
          viewerSection === ConversationSection.INBOX &&
          (isFriend || Boolean(conv.lastMessageId));
        const listableRequest =
          (viewerSection === ConversationSection.RECEIVED_REQUESTS ||
            viewerSection === ConversationSection.SENT_REQUESTS) &&
          Boolean(conv.lastMessageId);

        if (listableInbox || listableRequest) {
          upsertHit({
            peerId,
            viewerSection: listableInbox ? ConversationSection.INBOX : viewerSection,
            matchKind: "name",
            conversation: conv,
            activityAt: (conv.lastMessageAt || conv.createdAt).getTime()
          });
          continue;
        }
      }

      const recv = pendingRecvByPeer.get(peerId);
      if (recv) {
        upsertHit({
          peerId,
          viewerSection: ConversationSection.RECEIVED_REQUESTS,
          matchKind: "name",
          pendingRequest: { id: recv.id, createdAt: recv.createdAt, direction: "received" },
          activityAt: recv.createdAt.getTime()
        });
        continue;
      }
      const sent = pendingSentByPeer.get(peerId);
      if (sent) {
        upsertHit({
          peerId,
          viewerSection: ConversationSection.SENT_REQUESTS,
          matchKind: "name",
          pendingRequest: { id: sent.id, createdAt: sent.createdAt, direction: "sent" },
          activityAt: sent.createdAt.getTime()
        });
      }
    }

    // Message matches
    for (const [peerId, msg] of messageMatchByPeer) {
      const conv = convByPeer.get(peerId);
      if (!conv) continue;
      const isFriend = friendSet.has(peerId);
      const viewerSection = this.viewerSectionForConversation(userId, conv, isFriend);
      const snippet = msg.message ? this.buildMatchSnippet(msg.message, q) : undefined;
      const existing = hitsByPeer.get(peerId);
      if (existing) {
        // Upgrade activity / attach snippet; keep name matchKind if already name
        hitsByPeer.set(peerId, {
          ...existing,
          conversation: existing.conversation || conv,
          matchSnippet: existing.matchKind === "message" ? snippet : existing.matchSnippet || snippet,
          activityAt: Math.max(existing.activityAt, msg.createdAt.getTime(), (conv.lastMessageAt || conv.createdAt).getTime())
        });
      } else {
        upsertHit({
          peerId,
          viewerSection,
          matchKind: "message",
          matchSnippet: snippet,
          conversation: conv,
          activityAt: Math.max(msg.createdAt.getTime(), (conv.lastMessageAt || conv.createdAt).getTime())
        });
      }
    }

    // Apply message-type / only_follows filters
    let hits = [...hitsByPeer.values()];

    if (filter === "only_follows") {
      hits = hits.filter(
        (h) =>
          h.pendingRequest ||
          (h.conversation && !h.conversation.lastMessageId && !friendSet.has(h.peerId))
      );
    } else if (filter === "text_only" || filter === "with_gift") {
      // Need last message types — fetch for candidates with conversation
      const lastIds = hits
        .map((h) => h.conversation?.lastMessageId)
        .filter((id): id is string => Boolean(id));
      const lastMessages =
        lastIds.length > 0
          ? await this.prisma.friendMessage.findMany({
              where: { id: { in: lastIds } },
              select: { id: true, messageType: true }
            })
          : [];
      const typeMap = new Map(lastMessages.map((m) => [m.id, m.messageType]));
      hits = hits.filter((h) => {
        const lid = h.conversation?.lastMessageId;
        if (!lid) return false;
        const t = typeMap.get(lid);
        if (!t) return false;
        if (filter === "text_only") return t === MessageType.TEXT;
        return t === MessageType.GIFT || t === MessageType.GIFT_WITH_MESSAGE;
      });
    } else {
      // Default listing rules for request sections: need last message OR pending FR
      hits = hits.filter((h) => {
        if (h.viewerSection === ConversationSection.INBOX) {
          return friendSet.has(h.peerId) || Boolean(h.conversation?.lastMessageId);
        }
        return Boolean(h.conversation?.lastMessageId) || Boolean(h.pendingRequest);
      });
    }

    const sectionCounts = {
      inbox: hits.filter((h) => h.viewerSection === ConversationSection.INBOX).length,
      received: hits.filter((h) => h.viewerSection === ConversationSection.RECEIVED_REQUESTS).length,
      sent: hits.filter((h) => h.viewerSection === ConversationSection.SENT_REQUESTS).length
    };

    const sectionHits = hits
      .filter((h) => h.viewerSection === section)
      .sort((a, b) => {
        if (a.matchKind !== b.matchKind) {
          return a.matchKind === "name" ? -1 : 1;
        }
        return b.activityAt - a.activityAt;
      });

    const hasMore = sectionHits.length > offset + limit;
    const page = sectionHits.slice(offset, offset + limit);

    // Build response rows
    const convRows = page.filter((h) => h.conversation).map((h) => h.conversation!);
    const lastMessageIds = convRows
      .map((c) => c.lastMessageId)
      .filter((id): id is string => Boolean(id));

    // Include matched messages that might not be lastMessage
    for (const h of page) {
      const matched = messageMatchByPeer.get(h.peerId);
      if (matched) lastMessageIds.push(matched.id);
    }

    const lastMessages =
      lastMessageIds.length > 0
        ? await this.prisma.friendMessage.findMany({
            where: { id: { in: [...new Set(lastMessageIds)] } },
            select: {
              id: true,
              fromUserId: true,
              toUserId: true,
              message: true,
              messageType: true,
              giftId: true,
              giftAmount: true,
              squadMeta: true,
              createdAt: true
            }
          })
        : [];
    const lastMessageMap = new Map(lastMessages.map((m) => [m.id, m]));

    const detailed =
      convRows.length > 0
        ? await this.getConversationDetails(userId, convRows, lastMessageMap)
        : [];
    const detailById = new Map(detailed.map((d) => [d.id, d]));

    const syntheticPeers = page.filter((h) => !h.conversation).map((h) => h.peerId);
    const pagePeerIds = [...new Set(page.map((h) => h.peerId).filter(Boolean))];
    const { validIds: validSearchPeerIds } =
      await this.userClient.validateUserIds(pagePeerIds);
    const validSearchPeerSet = new Set(validSearchPeerIds);

    const liveSyntheticPeers = syntheticPeers.filter((id) => validSearchPeerSet.has(id));
    const syntheticStatusMap =
      liveSyntheticPeers.length > 0
        ? await this.streamingClient.getUserStatuses(liveSyntheticPeers).catch(() => new Map())
        : new Map();
    const missingProfiles = liveSyntheticPeers.filter((id) => !profileFromName.has(id));
    const fetchedProfiles = await Promise.all(
      missingProfiles.map((id) => this.userClient.getUserProfile(id))
    );
    const missingSearchPeerSet = new Set<string>();
    for (let i = 0; i < missingProfiles.length; i++) {
      if (fetchedProfiles[i]?.missing) {
        missingSearchPeerSet.add(missingProfiles[i]);
        continue;
      }
      profileFromName.set(missingProfiles[i], {
        id: missingProfiles[i],
        ...fetchedProfiles[i]
      });
    }

    const conversations = page
      .filter((h) => validSearchPeerSet.has(h.peerId) && !missingSearchPeerSet.has(h.peerId))
      .map((h) => {
        if (h.conversation) {
          const base = detailById.get(h.conversation.id);
          if (base) {
            return {
              ...base,
              matchKind: h.matchKind,
              matchSnippet: h.matchKind === "message" ? h.matchSnippet : undefined
            };
          }
          // Peer was dropped in getConversationDetails (hard-deleted). Don't synthesize a ghost row.
          return null;
        }

      const req = h.pendingRequest;
      const profile = profileFromName.get(h.peerId) || {
        username: null,
        displayPictureUrl: null
      };
      const userStatus = syntheticStatusMap.get(h.peerId) || {
        status: "offline",
        isBroadcasting: false,
        roomId: null,
        broadcastUrl: null
      };
      const syntheticId =
        req?.direction === "sent"
          ? `outgoing_fr_${req.id}`
          : `pending_fr_${req?.id || h.peerId}`;

      return {
        id: syntheticId,
        conversationId: syntheticId,
        otherUserId: h.peerId,
        otherUser: {
          id: h.peerId,
          username: profile?.username || "User",
          displayPictureUrl: profile?.displayPictureUrl || null
        },
        section: h.viewerSection,
        lastMessage: null,
        unreadCount: 0,
        isFriend: false,
        isFollowRequest: req?.direction === "received",
        isOutgoingFriendRequest: req?.direction === "sent",
        followRequestId: req?.direction === "received" ? req.id : null,
        outgoingFriendRequestId: req?.direction === "sent" ? req.id : null,
        userStatus: userStatus.status,
        isBroadcasting: userStatus.isBroadcasting,
        broadcastRoomId: userStatus.roomId,
        broadcastUrl: userStatus.broadcastUrl,
        lastMessageAt: req?.createdAt || new Date(h.activityAt),
        createdAt: req?.createdAt || new Date(h.activityAt),
        matchKind: h.matchKind,
        matchSnippet: undefined
      };
    })
    .filter((c): c is NonNullable<typeof c> => c != null);

    return {
      conversations,
      nextCursor: hasMore ? String(offset + limit) : undefined,
      hasMore,
      sectionCounts
    };
  }
}
