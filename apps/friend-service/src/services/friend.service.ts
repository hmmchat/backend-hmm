import { Injectable, Logger, BadRequestException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { WalletClientService } from "./wallet-client.service.js";
import { RedisService } from "./redis.service.js";
import { MetricsService } from "./metrics.service.js";
import { ConversationService } from "./conversation.service.js";
import { GiftCatalogService } from "./gift-catalog.service.js";
import { UserClientService } from "./user-client.service.js";
import { MessagingRealtimeService } from "./messaging-realtime.service.js";
import { MessageType, ConversationSection } from "../../node_modules/.prisma/client/index.js";
import * as crypto from "crypto";

@Injectable()
export class FriendService {
  private readonly logger = new Logger(FriendService.name);
  private readonly REQUEST_EXPIRY_DAYS = parseInt(process.env.REQUEST_EXPIRY_DAYS || "30", 10);
  private readonly FIRST_MESSAGE_COST_COINS = parseInt(
    process.env.FIRST_MESSAGE_COST_COINS || "10",
    10
  );
  private readonly HOTLINE_MESSAGE_COST = parseInt(
    process.env.HOTLINE_MESSAGE_COST || "10",
    10
  );
  private readonly MAX_MESSAGE_LENGTH = parseInt(
    process.env.MAX_MESSAGE_LENGTH || "1000",
    10
  );
  private readonly SPAM_DETECTION_WINDOW = parseInt(
    process.env.SPAM_DETECTION_WINDOW_SECONDS || "60",
    10
  );
  private readonly NOTIFICATION_COUNT_CACHE_TTL = parseInt(
    process.env.NOTIFICATION_COUNT_CACHE_TTL_SECONDS || "30",
    10
  );
  private readonly FRIENDS_WALL_PHOTOS_PER_PAGE = parseInt(
    process.env.FRIENDS_WALL_PHOTOS_PER_PAGE || "35",
    10
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletClient: WalletClientService,
    private readonly redis: RedisService,
    private readonly metrics: MetricsService,
    private readonly conversationService: ConversationService,
    private readonly giftCatalog: GiftCatalogService,
    private readonly userClient: UserClientService,
    private readonly realtime: MessagingRealtimeService
  ) {}


  /**
   * Send friend request
   */
  async sendFriendRequest(
    fromUserId: string,
    toUserId: string,
    message?: string
  ): Promise<{ requestId: string; autoAccepted: boolean }> {
    if (fromUserId === toUserId) {
      throw new BadRequestException("Cannot send friend request to yourself");
    }

    // Check if already friends
    const areFriends = await this.areFriends(fromUserId, toUserId);
    if (areFriends) {
      throw new BadRequestException("Users are already friends");
    }

    // Check if request already exists
    const existingRequest = await this.prisma.friendRequest.findFirst({
      where: {
        OR: [
          { fromUserId, toUserId },
          { fromUserId: toUserId, toUserId: fromUserId } // Check reverse too
        ],
        status: {
          in: ["PENDING", "ACCEPTED"]
        }
      }
    });

    if (existingRequest) {
      if (existingRequest.status === "ACCEPTED") {
        throw new BadRequestException("Users are already friends");
      }
      if (existingRequest.fromUserId === fromUserId && existingRequest.toUserId === toUserId) {
        throw new BadRequestException("Friend request already sent");
      }
      // If reverse request exists (mutual request), auto-accept both
      if (existingRequest.fromUserId === toUserId && existingRequest.toUserId === fromUserId) {
        const result = await this.acceptMutualRequest(existingRequest.id, fromUserId, toUserId, message);
        return { ...result, autoAccepted: true };
      }
    }

    // Create request with 30-day expiry
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.REQUEST_EXPIRY_DAYS);

    const request = await this.prisma.friendRequest.create({
      data: {
        fromUserId,
        toUserId,
        message: message || null,
        expiresAt
      }
    });

    this.logger.log(`Friend request sent from ${fromUserId} to ${toUserId}`);
    this.metrics.incrementFriendRequestSent(false);
    
    // Invalidate notification cache for recipient (they have a new friend request)
    await this.invalidateNotificationCache(toUserId);
    this.emitRealtimeConversationRefresh(fromUserId, toUserId, "friend_request_sent");
    
    return { requestId: request.id, autoAccepted: false };
  }

  /**
   * Accept mutual request (auto-accept when both users send requests)
   * Wrapped in transaction to ensure atomicity and prevent race conditions
   */
  private async acceptMutualRequest(
    existingRequestId: string,
    newFromUserId: string,
    newToUserId: string,
    message?: string
  ): Promise<{ requestId: string; autoAccepted: boolean }> {
    // Use transaction to ensure all operations succeed or fail together
    const result = await this.prisma.$transaction(async (tx) => {
      // Accept the existing request
      await tx.friendRequest.update({
        where: { id: existingRequestId },
        data: {
          status: "ACCEPTED",
          acceptedAt: new Date()
        }
      });

      // Create the new request and immediately accept it
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + this.REQUEST_EXPIRY_DAYS);

      const newRequest = await tx.friendRequest.create({
        data: {
          fromUserId: newFromUserId,
          toUserId: newToUserId,
          message: message || null,
          status: "ACCEPTED",
          acceptedAt: new Date(),
          expiresAt
        }
      });

      // Create friendship record (both directions) - check if already exists to prevent duplicates
      const [id1, id2] = [newFromUserId, newToUserId].sort();
      await tx.friend.upsert({
        where: {
          userId1_userId2: {
            userId1: id1,
            userId2: id2
          }
        },
        create: {
          userId1: id1,
          userId2: id2
        },
        update: {} // No update needed if exists
      });

      // Move conversation to inbox if it exists
      await tx.conversation.updateMany({
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

      this.logger.log(`Mutual friend request auto-accepted between ${newFromUserId} and ${newToUserId}`);
      this.metrics.incrementFriendRequestSent(true);
      this.metrics.incrementFriendshipCreated();
      // Invalidate friendship cache for both users
      await this.invalidateFriendshipCache(newFromUserId, newToUserId);
      // Invalidate notification cache for both users (friend request count changed)
      await this.invalidateNotificationCache(newFromUserId);
      await this.invalidateNotificationCache(newToUserId);
      return { requestId: newRequest.id, autoAccepted: true };
    });
    this.emitRealtimeConversationRefresh(newFromUserId, newToUserId, "friend_request_auto_accepted");
    return result;
  }

  /**
   * Accept friend request
   */
  async acceptFriendRequest(requestId: string, userId: string): Promise<void> {
    const request = await this.prisma.friendRequest.findUnique({
      where: { id: requestId }
    });

    if (!request) {
      throw new NotFoundException("Friend request not found");
    }

    if (request.toUserId !== userId) {
      throw new BadRequestException("You can only accept requests sent to you");
    }

    if (request.status !== "PENDING") {
      throw new BadRequestException(`Request is already ${request.status.toLowerCase()}`);
    }

    // Check expiry
    if (request.expiresAt && request.expiresAt < new Date()) {
      throw new BadRequestException("Friend request has expired");
    }

    // Check if already friends
    const areFriends = await this.areFriends(request.fromUserId, request.toUserId);
    if (areFriends) {
      throw new BadRequestException("Users are already friends");
    }

    // Update request status
    await this.prisma.friendRequest.update({
      where: { id: requestId },
      data: {
        status: "ACCEPTED",
        acceptedAt: new Date()
      }
    });

    // Create friendship
    await this.createFriendship(request.fromUserId, request.toUserId);

    // Move conversation to inbox if it exists
    const [id1, id2] = [request.fromUserId, request.toUserId].sort();
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

    this.metrics.incrementFriendRequestAccepted();
    this.metrics.incrementFriendshipCreated();
    // Invalidate friendship cache for both users
    await this.invalidateFriendshipCache(request.fromUserId, request.toUserId);
    // Invalidate notification cache for both users (friend request count changed)
    await this.invalidateNotificationCache(request.fromUserId);
    await this.invalidateNotificationCache(request.toUserId);

    this.logger.log(`Friend request ${requestId} accepted by ${userId}`);
    this.emitRealtimeConversationRefresh(request.fromUserId, request.toUserId, "friend_request_accepted");
  }

  /**
   * Reject friend request
   */
  async rejectFriendRequest(requestId: string, userId: string): Promise<void> {
    const request = await this.prisma.friendRequest.findUnique({
      where: { id: requestId }
    });

    if (!request) {
      throw new NotFoundException("Friend request not found");
    }

    if (request.toUserId !== userId) {
      throw new BadRequestException("You can only reject requests sent to you");
    }

    if (request.status !== "PENDING") {
      throw new BadRequestException(`Request is already ${request.status.toLowerCase()}`);
    }

    await this.prisma.friendRequest.update({
      where: { id: requestId },
      data: {
        status: "REJECTED",
        rejectedAt: new Date()
      }
    });

    this.metrics.incrementFriendRequestRejected();
    this.logger.log(`Friend request ${requestId} rejected by ${userId}`);
    this.emitRealtimeConversationRefresh(request.fromUserId, request.toUserId, "friend_request_rejected");
  }

  /**
   * Get pending requests (incoming)
   */
  async getPendingRequests(userId: string): Promise<any[]> {
    const requests = await this.prisma.friendRequest.findMany({
      where: {
        toUserId: userId,
        status: "PENDING",
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } }
        ]
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    return requests.map(req => ({
      id: req.id,
      fromUserId: req.fromUserId,
      message: req.message,
      createdAt: req.createdAt,
      expiresAt: req.expiresAt
    }));
  }

  /**
   * Get sent requests (outgoing)
   */
  async getSentRequests(userId: string): Promise<any[]> {
    const requests = await this.prisma.friendRequest.findMany({
      where: {
        fromUserId: userId,
        status: "PENDING",
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } }
        ]
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    return requests.map(req => ({
      id: req.id,
      toUserId: req.toUserId,
      message: req.message,
      createdAt: req.createdAt,
      expiresAt: req.expiresAt
    }));
  }

  /**
   * Get all friends with pagination
   */
  async getFriends(
    userId: string,
    limit: number = 50,
    cursor?: string
  ): Promise<{
    friends: any[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    const friendships = await this.prisma.friend.findMany({
      where: {
        OR: [
          { userId1: userId },
          { userId2: userId }
        ]
      },
      orderBy: {
        createdAt: "desc"
      },
      take: limit + 1, // Fetch one extra to check if there are more
      ...(cursor && {
        cursor: { id: cursor },
        skip: 1
      })
    });

    const hasMore = friendships.length > limit;
    const resultFriendships = hasMore ? friendships.slice(0, limit) : friendships;
    const nextCursor = hasMore ? resultFriendships[resultFriendships.length - 1].id : undefined;

    return {
      friends: resultFriendships.map(friendship => ({
        friendId: friendship.userId1 === userId ? friendship.userId2 : friendship.userId1,
        createdAt: friendship.createdAt
      })),
      nextCursor,
      hasMore
    };
  }

  /**
   * Get friends wall - paginated friends with their profile photos
   * Returns friends with displayPictureUrl for grid display
   */
  async getFriendsWall(
    userId: string,
    limit?: number,
    cursor?: string
  ): Promise<{
    friends: Array<{
      friendId: string;
      photoUrl: string | null;
      createdAt: Date;
    }>;
    nextCursor?: string;
    hasMore: boolean;
    pageSize: number;
  }> {
    // Use configured page size if limit not provided
    const pageSize = limit || this.FRIENDS_WALL_PHOTOS_PER_PAGE;

    // Get friends list using existing method
    const friendsResult = await this.getFriends(userId, pageSize, cursor);

    if (friendsResult.friends.length === 0) {
      return {
        friends: [],
        nextCursor: undefined,
        hasMore: false,
        pageSize
      };
    }

    // Extract friend IDs
    const friendIds = friendsResult.friends.map(f => f.friendId);

    // Batch fetch display pictures from user-service
    const photoMap = await this.userClient.getUsersDisplayPictures(friendIds);

    // Enrich friends with photos
    const enrichedFriends = friendsResult.friends.map(friend => ({
      friendId: friend.friendId,
      photoUrl: photoMap.get(friend.friendId) || null,
      createdAt: friend.createdAt
    }));

    return {
      friends: enrichedFriends,
      nextCursor: friendsResult.nextCursor,
      hasMore: friendsResult.hasMore,
      pageSize
    };
  }

  /**
   * Get friend request by ID
   */
  async getRequest(requestId: string): Promise<any> {
    const request = await this.prisma.friendRequest.findUnique({
      where: { id: requestId }
    });

    if (!request) {
      throw new NotFoundException("Friend request not found");
    }

    return request;
  }

  /**
   * Get messages for a pending request
   */
  async getRequestMessages(requestId: string, userId: string): Promise<any[]> {
    const request = await this.getRequest(requestId);

    // Verify user is part of the request
    if (request.fromUserId !== userId && request.toUserId !== userId) {
      throw new BadRequestException("You are not part of this request");
    }

    const messages = await this.prisma.friendMessage.findMany({
      where: {
        OR: [
          { fromUserId: request.fromUserId, toUserId: request.toUserId },
          { fromUserId: request.toUserId, toUserId: request.fromUserId }
        ]
      },
      orderBy: {
        createdAt: "asc"
      }
    });

    const mapped = messages.map((msg) => ({
      id: msg.id,
      fromUserId: msg.fromUserId,
      toUserId: msg.toUserId,
      message: msg.message,
      gif: (msg as any).gifId
        ? {
            provider: (msg as any).gifProvider,
            id: (msg as any).gifId,
            url: (msg as any).gifUrl,
            previewUrl: (msg as any).gifPreviewUrl,
            width: (msg as any).gifWidth,
            height: (msg as any).gifHeight
          }
        : null,
      isRead: msg.isRead,
      readAt: msg.readAt,
      transactionId: msg.transactionId,
      giftId: msg.giftId,
      giftAmount: msg.giftAmount,
      messageType: msg.messageType,
      createdAt: msg.createdAt
    }));
    return this.giftCatalog.attachGiftImageUrls(mapped);
  }

  /**
   * Check if user is blocked
   */
  private async isBlocked(blockerId: string, blockedId: string): Promise<boolean> {
    const blockedRequest = await this.prisma.friendRequest.findFirst({
      where: {
        OR: [
          { fromUserId: blockerId, toUserId: blockedId, status: "BLOCKED" },
          { fromUserId: blockedId, toUserId: blockerId, status: "BLOCKED" }
        ]
      }
    });

    return blockedRequest !== null;
  }

  /**
   * Check for spam (duplicate message within time window)
   */
  private async isSpam(fromUserId: string, toUserId: string, message: string | null): Promise<boolean> {
    if (!message || message.trim().length === 0) {
      return false; // Empty messages can't be spam
    }

    const trimmedMessage = message.trim();
    
    // Create hash of message content
    const messageHash = crypto.createHash("sha256").update(trimmedMessage.toLowerCase()).digest("hex");
    const spamKey = `spam:${fromUserId}:${toUserId}:${messageHash}`;

    if (!this.redis.isAvailable()) {
      // If Redis unavailable, check database for recent duplicate
      const recentMessage = await this.prisma.friendMessage.findFirst({
        where: {
          fromUserId,
          toUserId,
          message: {
            equals: trimmedMessage,
            mode: "insensitive"
          },
          createdAt: {
            gte: new Date(Date.now() - this.SPAM_DETECTION_WINDOW * 1000)
          }
        }
      });

      return recentMessage !== null;
    }

    // Check Redis for spam
    const exists = await this.redis.get(spamKey);
    if (exists) {
      return true;
    }

    // Set spam key with window TTL
    await this.redis.set(spamKey, "1", this.SPAM_DETECTION_WINDOW);
    return false;
  }

  /**
   * Get message count in conversation (for determining first message)
   */
  private async getMessageCountInConversation(fromUserId: string, toUserId: string): Promise<number> {
    return await this.prisma.friendMessage.count({
      where: {
        OR: [
          { fromUserId, toUserId },
          { fromUserId: toUserId, toUserId: fromUserId }
        ]
      }
    });
  }

  /**
   * Send message to non-friend with new monetization rules
   * CRITICAL: Uses transaction atomicity to prevent coin loss
   */
  async sendMessageToNonFriend(
    fromUserId: string,
    toUserId: string,
    message: string | null,
    requestId: string, // Friend request ID
    giftId?: string,
    giftAmount?: number,
    gif?: {
      provider: "giphy";
      id: string;
      url: string;
      previewUrl?: string;
      width?: number;
      height?: number;
    }
  ): Promise<{ messageId: string; newBalance?: number; promotedToInbox?: boolean }> {
    if (fromUserId === toUserId) {
      throw new BadRequestException("Cannot send message to yourself");
    }

    // CRITICAL: Validate user account status
    const [senderActive, recipientActive] = await Promise.all([
      this.userClient.isAccountActive(fromUserId),
      this.userClient.isAccountActive(toUserId)
    ]);

    if (!senderActive) {
      throw new BadRequestException("Your account is not active. Please contact support.");
    }

    if (!recipientActive) {
      throw new BadRequestException("Recipient account is not active");
    }

    // CRITICAL: Check if blocked
    const isUserBlocked = await this.isBlocked(fromUserId, toUserId);
    if (isUserBlocked) {
      throw new BadRequestException("You cannot message this user");
    }

    // Validate message length (text only)
    if (message && message.length > this.MAX_MESSAGE_LENGTH) {
      throw new BadRequestException(`Message exceeds maximum length of ${this.MAX_MESSAGE_LENGTH} characters`);
    }

    // CRITICAL: Check for spam (only for text messages)
    if (message) {
      const isSpamMessage = await this.isSpam(fromUserId, toUserId, message);
      if (isSpamMessage) {
        throw new BadRequestException("Duplicate message detected. Please wait before sending the same message again.");
      }
    }

    // Verify request exists
    const request = await this.prisma.friendRequest.findUnique({
      where: { id: requestId }
    });

    if (!request) {
      throw new NotFoundException("Friend request not found");
    }

    if (request.fromUserId !== fromUserId || request.toUserId !== toUserId) {
      throw new BadRequestException("Request does not match users");
    }

    if (request.status !== "PENDING") {
      throw new BadRequestException("Can only send messages to pending requests");
    }

    // Get message count to determine if first message (before transaction)
    const messageCount = await this.getMessageCountInConversation(fromUserId, toUserId);
    const isFirstMessage = messageCount === 0;

    const hasGif = !!gif;
    const hasText = !!(message && message.trim().length > 0);

    // Determine message type
    let messageType: MessageType = MessageType.TEXT;
    if (hasGif && hasText) {
      messageType = "GIF_WITH_MESSAGE" as any;
    } else if (hasGif) {
      messageType = "GIF" as any;
    } else if (giftId && !hasText) {
      messageType = MessageType.GIFT;
    } else if (giftId && hasText) {
      messageType = MessageType.GIFT_WITH_MESSAGE;
    }

    // CRITICAL: Validate gift if provided
    if (giftId) {
      if (!giftAmount) {
        throw new BadRequestException("Gift amount is required when sending a gift");
      }
      await this.giftCatalog.validateGift(giftId, giftAmount);
    }

    // Determine if we need to charge for message (text or gif counts)
    const needsPayment = !giftId && (hasText || hasGif) && isFirstMessage;
    const cost = needsPayment ? this.FIRST_MESSAGE_COST_COINS : 0;

    // Check if subsequent message without gift (not allowed)
    if (!isFirstMessage && !giftId && (hasText || hasGif)) {
      throw new BadRequestException(
        "Subsequent messages require a gift. Please send a gift with your message."
      );
    }

    // CRITICAL: Use transaction to ensure atomicity
    const result = await this.prisma.$transaction(async (tx) => {
      let transactionId: string | undefined;
      let newBalance: number | undefined;

      // Step 1: Deduct coins if needed (for first message or gift)
      if (cost > 0) {
        const result = await this.walletClient.deductCoins(
          fromUserId,
          cost,
          `First message to non-friend: ${toUserId}`
        );
        transactionId = result.transactionId;
        newBalance = result.newBalance;
      } else if (giftId && giftAmount) {
        // Transfer diamonds for gift (gifts give diamonds)
        const result = await this.walletClient.transferDiamonds(
          fromUserId,
          toUserId,
          giftAmount,
          `Gift to user ${toUserId}`,
          giftId
        );
        transactionId = result.transactionId;
        newBalance = result.newBalance;
      }

      // Step 2: Create message in database
      const friendMessage = await tx.friendMessage.create({
        data: {
          fromUserId,
          toUserId,
          message: message || null,
          gifProvider: gif?.provider || null,
          gifId: gif?.id || null,
          gifUrl: gif?.url || null,
          gifPreviewUrl: gif?.previewUrl || null,
          gifWidth: gif?.width ?? null,
          gifHeight: gif?.height ?? null,
          transactionId,
          giftId: giftId || null,
          giftAmount: giftAmount || null,
          messageType
        } as any
      });

      // Step 3: Check friendship within transaction
      const [id1, id2] = [fromUserId, toUserId].sort();
      const friendship = await tx.friend.findUnique({
        where: {
          userId1_userId2: {
            userId1: id1,
            userId2: id2
          }
        }
      });
      const areFriends = friendship !== null;

      // Step 4: Determine section (after message is created)
      // Section is stored from userId1's perspective (smaller ID)
      // Check if both users have sent messages (including the one just created)
      const messagesFromOtherUser = await tx.friendMessage.findFirst({
        where: {
          fromUserId: toUserId,
          toUserId: fromUserId,
          id: { not: friendMessage.id } // Exclude the message we just created
        }
      });

      let newSection: ConversationSection = ConversationSection.INBOX;
      if (!areFriends) {
        const hasMessagesFromOtherUser = messagesFromOtherUser !== null;

        if (hasMessagesFromOtherUser) {
          // Both users have messages = two-sided = INBOX
          newSection = ConversationSection.INBOX;
        } else {
          // Determine section from userId1's perspective
          const [id1, _id2] = [fromUserId, toUserId].sort();
          
          if (fromUserId === id1) {
            // fromUserId is userId1, they sent message = SENT_REQUESTS from their perspective
            newSection = ConversationSection.SENT_REQUESTS;
          } else {
            // fromUserId is userId2, they sent message = RECEIVED_REQUESTS from userId1's perspective
            // (because userId1 received it)
            newSection = ConversationSection.RECEIVED_REQUESTS;
          }
        }
      }

      // Step 5: Update conversation within transaction
      const [convId1, convId2] = [fromUserId, toUserId].sort();
      await tx.conversation.upsert({
        where: {
          userId1_userId2: {
            userId1: convId1,
            userId2: convId2
          }
        },
        create: {
          userId1: convId1,
          userId2: convId2,
          section: newSection,
          lastMessageId: friendMessage.id,
          lastMessageAt: new Date()
        },
        update: {
          section: newSection,
          lastMessageId: friendMessage.id,
          lastMessageAt: new Date()
        }
      });

      // Step 6: Check if conversation was promoted to inbox
      // Get existing conversation section before update
      const existingConv = await tx.conversation.findUnique({
        where: {
          userId1_userId2: {
            userId1: convId1,
            userId2: convId2
          }
        }
      });
      const wasPromoted = existingConv && 
                         existingConv.section !== ConversationSection.INBOX && 
                         newSection === ConversationSection.INBOX;

      this.metrics.incrementMessageSentToNonFriend();
      const costDesc =
        giftId && giftAmount != null
          ? `${giftAmount} diamonds (gift)`
          : cost > 0
            ? `${cost} coins (first message)`
            : "0";
      this.logger.log(
        `Message sent from ${fromUserId} to non-friend ${toUserId} ` +
        `(type: ${messageType}, cost: ${costDesc})`
      );

      // Invalidate notification cache for recipient (they have a new unread message)
      await this.invalidateNotificationCache(toUserId);

      return {
        messageId: friendMessage.id,
        newBalance,
        promotedToInbox: wasPromoted || undefined
      };
    });
    // Realtime emit (best-effort)
    this.emitRealtimeMessageUpdate(fromUserId, toUserId, result.messageId).catch(() => undefined);
    return result;
  }

  /**
   * Send message to friend (free - unlimited messages)
   * Supports text, gift, or gift+message
   */
  async sendMessageToFriend(
    fromUserId: string,
    toUserId: string,
    message: string | null,
    giftId?: string,
    giftAmount?: number,
    gif?: {
      provider: "giphy";
      id: string;
      url: string;
      previewUrl?: string;
      width?: number;
      height?: number;
    }
  ): Promise<{ messageId: string; newBalance?: number }> {
    if (fromUserId === toUserId) {
      throw new BadRequestException("Cannot send message to yourself");
    }

    // CRITICAL: Validate user account status
    const [senderActive, recipientActive] = await Promise.all([
      this.userClient.isAccountActive(fromUserId),
      this.userClient.isAccountActive(toUserId)
    ]);

    if (!senderActive) {
      throw new BadRequestException("Your account is not active. Please contact support.");
    }

    if (!recipientActive) {
      throw new BadRequestException("Recipient account is not active");
    }

    // CRITICAL: Check if blocked
    const isUserBlocked = await this.isBlocked(fromUserId, toUserId);
    if (isUserBlocked) {
      throw new BadRequestException("You cannot message this user");
    }

    // Verify friendship
    const areFriends = await this.areFriends(fromUserId, toUserId);
    if (!areFriends) {
      throw new BadRequestException("Users are not friends");
    }

    // Validate message length (text only)
    if (message && message.length > this.MAX_MESSAGE_LENGTH) {
      throw new BadRequestException(`Message exceeds maximum length of ${this.MAX_MESSAGE_LENGTH} characters`);
    }

    // CRITICAL: Validate gift if provided
    if (giftId) {
      if (!giftAmount) {
        throw new BadRequestException("Gift amount is required when sending a gift");
      }
      await this.giftCatalog.validateGift(giftId, giftAmount);
    }

    const hasGif = !!gif;
    const hasText = !!(message && message.trim().length > 0);

    // Determine message type
    let messageType: MessageType = MessageType.TEXT;
    if (hasGif && hasText) {
      messageType = "GIF_WITH_MESSAGE" as any;
    } else if (hasGif) {
      messageType = "GIF" as any;
    } else if (giftId && !hasText) {
      messageType = MessageType.GIFT;
    } else if (giftId && hasText) {
      messageType = MessageType.GIFT_WITH_MESSAGE;
    }

    // Use transaction for atomicity
    const result = await this.prisma.$transaction(async (tx) => {
      let transactionId: string | undefined;
      let newBalance: number | undefined;

      // If gift is sent, transfer diamonds (gifts give diamonds)
      if (giftId && giftAmount) {
        const result = await this.walletClient.transferDiamonds(
          fromUserId,
          toUserId,
          giftAmount,
          `Gift to friend ${toUserId}`,
          giftId
        );
        transactionId = result.transactionId;
        newBalance = result.newBalance;
      }

      // Create message (free for friends; gifts cost diamonds via transfer above)
      const friendMessage = await tx.friendMessage.create({
        data: {
          fromUserId,
          toUserId,
          message: message || null,
          gifProvider: gif?.provider || null,
          gifId: gif?.id || null,
          gifUrl: gif?.url || null,
          gifPreviewUrl: gif?.previewUrl || null,
          gifWidth: gif?.width ?? null,
          gifHeight: gif?.height ?? null,
          transactionId,
          giftId: giftId || null,
          giftAmount: giftAmount || null,
          messageType
        } as any
      });

      // Update conversation within transaction (friends always in inbox)
      const [convId1, convId2] = [fromUserId, toUserId].sort();
      await tx.conversation.upsert({
        where: {
          userId1_userId2: {
            userId1: convId1,
            userId2: convId2
          }
        },
        create: {
          userId1: convId1,
          userId2: convId2,
          section: ConversationSection.INBOX,
          lastMessageId: friendMessage.id,
          lastMessageAt: new Date()
        },
        update: {
          section: ConversationSection.INBOX,
          lastMessageId: friendMessage.id,
          lastMessageAt: new Date()
        }
      });

      this.metrics.incrementMessageSentToFriend();
      this.logger.log(
        `Message sent from ${fromUserId} to friend ${toUserId} ` +
        `(type: ${messageType}${giftAmount ? `, gift: ${giftAmount} diamonds` : ""})`
      );

      // Invalidate notification cache for recipient (they have a new unread message)
      await this.invalidateNotificationCache(toUserId);

      return {
        messageId: friendMessage.id,
        newBalance
      };
    });
    // Realtime emit (best-effort)
    this.emitRealtimeMessageUpdate(fromUserId, toUserId, result.messageId).catch(() => undefined);
    return result;
  }

  /**
   * Internal: squad invite row in the inviter↔invitee inbox (called by discovery-service).
   */
  async internalSendSquadInvite(params: {
    inviterId: string;
    inviteeId: string;
    invitationId: string;
  }): Promise<{ messageId: string }> {
    const { inviterId, inviteeId, invitationId } = params;
    if (inviterId === inviteeId) {
      throw new BadRequestException("Cannot send squad invite to yourself");
    }
    const areFriends = await this.areFriends(inviterId, inviteeId);
    if (!areFriends) {
      throw new BadRequestException("Users are not friends");
    }
    const isUserBlocked = await this.isBlocked(inviterId, inviteeId);
    if (isUserBlocked) {
      throw new BadRequestException("You cannot message this user");
    }

    const squadMeta = JSON.stringify({ invitationId, kind: "invite" });
    const bodyText = "You're invited to join my squad call.";

    const result = await this.prisma.$transaction(async (tx) => {
      const friendMessage = await tx.friendMessage.create({
        data: {
          fromUserId: inviterId,
          toUserId: inviteeId,
          message: bodyText,
          messageType: "SQUAD_INVITE" as MessageType,
          squadMeta
        } as any
      });

      const [convId1, convId2] = [inviterId, inviteeId].sort();
      await tx.conversation.upsert({
        where: {
          userId1_userId2: {
            userId1: convId1,
            userId2: convId2
          }
        },
        create: {
          userId1: convId1,
          userId2: convId2,
          section: ConversationSection.INBOX,
          lastMessageId: friendMessage.id,
          lastMessageAt: new Date()
        },
        update: {
          section: ConversationSection.INBOX,
          lastMessageId: friendMessage.id,
          lastMessageAt: new Date()
        }
      });

      return { messageId: friendMessage.id };
    });

    await this.invalidateNotificationCache(inviteeId);
    this.emitRealtimeMessageUpdate(inviterId, inviteeId, result.messageId).catch(() => undefined);
    return result;
  }

  /**
   * Internal: squad accept/reject outcome message (from invitee → inviter) visible in shared thread.
   */
  async internalSendSquadOutcome(params: {
    inviterId: string;
    inviteeId: string;
    invitationId: string;
    outcome: "accepted" | "rejected";
    /** Optional override for the visible message body (e.g. include invitee name on accept). */
    messageOverride?: string | null;
  }): Promise<{ messageId: string }> {
    const { inviterId, inviteeId, invitationId, outcome, messageOverride } = params;
    if (inviterId === inviteeId) {
      throw new BadRequestException("Invalid squad outcome");
    }
    const areFriends = await this.areFriends(inviterId, inviteeId);
    if (!areFriends) {
      throw new BadRequestException("Users are not friends");
    }

    const squadMeta = JSON.stringify({ invitationId, kind: "outcome", outcome });
    const trimmedOverride =
      typeof messageOverride === "string" && messageOverride.trim().length > 0
        ? messageOverride.trim().slice(0, 500)
        : null;
    const bodyText =
      trimmedOverride ||
      (outcome === "accepted"
        ? "Joined your squad call."
        : "Your friend declined your squad invite.");

    const result = await this.prisma.$transaction(async (tx) => {
      const friendMessage = await tx.friendMessage.create({
        data: {
          fromUserId: inviteeId,
          toUserId: inviterId,
          message: bodyText,
          messageType: "SQUAD_INVITE_OUTCOME" as MessageType,
          squadMeta
        } as any
      });

      const [convId1, convId2] = [inviterId, inviteeId].sort();
      await tx.conversation.upsert({
        where: {
          userId1_userId2: {
            userId1: convId1,
            userId2: convId2
          }
        },
        create: {
          userId1: convId1,
          userId2: convId2,
          section: ConversationSection.INBOX,
          lastMessageId: friendMessage.id,
          lastMessageAt: new Date()
        },
        update: {
          section: ConversationSection.INBOX,
          lastMessageId: friendMessage.id,
          lastMessageAt: new Date()
        }
      });

      return { messageId: friendMessage.id };
    });

    await this.invalidateNotificationCache(inviterId);
    await this.invalidateNotificationCache(inviteeId);
    this.emitRealtimeMessageUpdate(inviteeId, inviterId, result.messageId).catch(() => undefined);
    return result;
  }

  /**
   * Internal: squad system line in a friend thread (expiry, superseded invite, etc.).
   * Uses SQUAD_INVITE_OUTCOME + squadMeta.kind === "notice" so clients can disable invite actions.
   */
  async internalSendSquadThreadNotice(params: {
    fromUserId: string;
    toUserId: string;
    invitationId: string;
    bodyText: string;
    noticeType: string;
  }): Promise<{ messageId: string }> {
    const { fromUserId, toUserId, invitationId, bodyText, noticeType } = params;
    if (fromUserId === toUserId) {
      throw new BadRequestException("Invalid squad notice");
    }
    const areFriends = await this.areFriends(fromUserId, toUserId);
    if (!areFriends) {
      throw new BadRequestException("Users are not friends");
    }

    const squadMeta = JSON.stringify({
      invitationId,
      kind: "notice",
      noticeType
    });

    const result = await this.prisma.$transaction(async (tx) => {
      const friendMessage = await tx.friendMessage.create({
        data: {
          fromUserId,
          toUserId,
          message: bodyText.slice(0, 500),
          messageType: "SQUAD_INVITE_OUTCOME" as MessageType,
          squadMeta
        } as any
      });

      const [convId1, convId2] = [fromUserId, toUserId].sort();
      await tx.conversation.upsert({
        where: {
          userId1_userId2: {
            userId1: convId1,
            userId2: convId2
          }
        },
        create: {
          userId1: convId1,
          userId2: convId2,
          section: ConversationSection.INBOX,
          lastMessageId: friendMessage.id,
          lastMessageAt: new Date()
        },
        update: {
          section: ConversationSection.INBOX,
          lastMessageId: friendMessage.id,
          lastMessageAt: new Date()
        }
      });

      return { messageId: friendMessage.id };
    });

    await this.invalidateNotificationCache(toUserId);
    await this.invalidateNotificationCache(fromUserId);
    this.emitRealtimeMessageUpdate(fromUserId, toUserId, result.messageId).catch(() => undefined);
    return result;
  }

  /**
   * Get message history with a user (persisted messages)
   * Returns paginated message history from database
   */
  async getMessageHistory(
    userId: string,
    otherUserId: string,
    limit: number = 50,
    cursor?: string
  ): Promise<{
    messages: any[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    const dbMessages = await this.prisma.friendMessage.findMany({
      where: {
        OR: [
          { fromUserId: userId, toUserId: otherUserId },
          { fromUserId: otherUserId, toUserId: userId }
        ]
      },
      orderBy: {
        createdAt: "desc"
      },
      take: limit + 1, // Fetch one extra to check if there are more
      ...(cursor && {
        cursor: { id: cursor },
        skip: 1
      })
    });

    const hasMore = dbMessages.length > limit;
    const resultMessages = hasMore ? dbMessages.slice(0, limit) : dbMessages;
    const nextCursor = hasMore ? resultMessages[resultMessages.length - 1].id : undefined;

    const mapped = resultMessages.reverse().map((msg) => ({
      id: msg.id,
      fromUserId: msg.fromUserId,
      toUserId: msg.toUserId,
      message: msg.message,
      squadMeta: (msg as any).squadMeta ?? null,
      gif: (msg as any).gifId
        ? {
            provider: (msg as any).gifProvider,
            id: (msg as any).gifId,
            url: (msg as any).gifUrl,
            previewUrl: (msg as any).gifPreviewUrl,
            width: (msg as any).gifWidth,
            height: (msg as any).gifHeight
          }
        : null,
      isRead: msg.isRead,
      readAt: msg.readAt,
      transactionId: msg.transactionId, // Shows if message cost coins
      giftId: msg.giftId,
      giftAmount: msg.giftAmount,
      messageType: msg.messageType,
      createdAt: msg.createdAt
    }));
    const enriched = await this.giftCatalog.attachGiftImageUrls(mapped);
    return {
      messages: enriched,
      nextCursor,
      hasMore
    };
  }

  /**
   * Mark messages as read
   */
  async markMessagesAsRead(userId: string, otherUserId: string): Promise<void> {
    await this.prisma.friendMessage.updateMany({
      where: {
        fromUserId: otherUserId,
        toUserId: userId,
        isRead: false
      },
      data: {
        isRead: true,
        readAt: new Date()
      }
    });
    // Invalidate notification cache for reader (unread counts changed).
    await this.invalidateNotificationCache(userId);
    // Realtime emit (best-effort)
    try {
      this.realtime.emitToUser(otherUserId, "friend:read", { fromUserId: otherUserId, toUserId: userId });
      this.realtime.emitToUser(userId, "friend:read", { fromUserId: otherUserId, toUserId: userId });
    } catch {
      // ignore
    }
  }

  private async emitRealtimeMessageUpdate(fromUserId: string, toUserId: string, messageId: string) {
    const [id1, id2] = [fromUserId, toUserId].sort();
    const [conv, msg] = await Promise.all([
      this.prisma.conversation.findUnique({
        where: { userId1_userId2: { userId1: id1, userId2: id2 } }
      }),
      this.prisma.friendMessage.findUnique({ where: { id: messageId } })
    ]);
    if (!conv || !msg) return;

    // Same semantics as GET /conversations/inbox (read cursor + legacy isRead).
    const sender = msg.fromUserId;
    const recipient = msg.toUserId;
    const [unreadForRecipient, unreadForSender] = await Promise.all([
      this.conversationService.countIncomingUnreadFromPeer(sender, recipient),
      this.conversationService.countIncomingUnreadFromPeer(recipient, sender)
    ]);

    const base = {
      id: msg.id,
      conversationId: conv.id,
      fromUserId: msg.fromUserId,
      toUserId: msg.toUserId,
      message: msg.message,
      gif: (msg as any).gifId
        ? {
            provider: (msg as any).gifProvider,
            id: (msg as any).gifId,
            url: (msg as any).gifUrl,
            previewUrl: (msg as any).gifPreviewUrl,
            width: (msg as any).gifWidth,
            height: (msg as any).gifHeight
          }
        : null,
      messageType: msg.messageType,
      giftId: msg.giftId,
      giftAmount: msg.giftAmount,
      squadMeta: (msg as any).squadMeta ?? null,
      createdAt: msg.createdAt
    };
    // Each user gets their own authoritative unread count (matches GET /conversations/inbox).
    this.realtime.emitToUser(recipient, "friend:message", {
      ...base,
      unreadCountForConversation: unreadForRecipient
    });
    this.realtime.emitToUser(sender, "friend:message", {
      ...base,
      unreadCountForConversation: unreadForSender
    });
  }

  private emitRealtimeConversationRefresh(userA: string, userB: string, reason: string) {
    // Generic "refresh your lists" hint (keeps client logic simple and robust).
    // Clients can call loadLists + loadNotificationBadge on receipt.
    try {
      const data = { reason, at: new Date().toISOString(), users: [userA, userB] };
      this.realtime.emitToUser(userA, "friend:refresh", data);
      this.realtime.emitToUser(userB, "friend:refresh", data);
    } catch {
      // ignore
    }
  }

  /**
   * Block a user
   */
  async blockUser(fromUserId: string, toUserId: string): Promise<void> {
    if (fromUserId === toUserId) {
      throw new BadRequestException("Cannot block yourself");
    }

    // Update any pending requests to BLOCKED
    await this.prisma.friendRequest.updateMany({
      where: {
        OR: [
          { fromUserId, toUserId, status: "PENDING" },
          { fromUserId: toUserId, toUserId: fromUserId, status: "PENDING" }
        ]
      },
      data: {
        status: "BLOCKED"
      }
    });

    // Remove friendship if exists
    await this.removeFriendship(fromUserId, toUserId);

    this.metrics.incrementUserBlocked();
    // Invalidate friendship cache for both users
    await this.invalidateFriendshipCache(fromUserId, toUserId);

    this.logger.log(`User ${fromUserId} blocked ${toUserId}`);
    this.emitRealtimeConversationRefresh(fromUserId, toUserId, "user_blocked");
  }

  // Helper methods
  async areFriends(userId1: string, userId2: string): Promise<boolean> {
    const [id1, id2] = [userId1, userId2].sort();
    const cacheKey = `friends:${id1}:${id2}`;

    // Try cache first
    if (this.redis.isAvailable()) {
      const cached = await this.redis.get(cacheKey);
      if (cached !== null) {
        return cached === "true";
      }
    }

    // Query database
    const friendship = await this.prisma.friend.findUnique({
      where: {
        userId1_userId2: {
          userId1: id1,
          userId2: id2
        }
      }
    });

    const areFriends = !!friendship;

    // Cache result (5 minutes TTL)
    if (this.redis.isAvailable()) {
      await this.redis.set(cacheKey, areFriends ? "true" : "false", 300);
    }

    return areFriends;
  }

  /**
   * Get relationship info for History Hotline (internal)
   * Returns isFriend, conversationId, messageCost for messaging from history.
   */
  async getRelationship(
    userId: string,
    otherUserId: string
  ): Promise<{ isFriend: boolean; conversationId: string; messageCost: number }> {
    const isFriend = await this.areFriends(userId, otherUserId);
    const { id: conversationId } = await this.conversationService.getOrCreateConversation(
      userId,
      otherUserId
    );
    const messageCost = isFriend ? 0 : this.HOTLINE_MESSAGE_COST;
    return { isFriend, conversationId, messageCost };
  }

  /**
   * Get relationship info for multiple users (batch, for History)
   */
  async getRelationshipsBatch(
    userId: string,
    otherUserIds: string[]
  ): Promise<Map<string, { isFriend: boolean; conversationId: string; messageCost: number }>> {
    const result = new Map<
      string,
      { isFriend: boolean; conversationId: string; messageCost: number }
    >();
    const unique = [...new Set(otherUserIds)];
    await Promise.all(
      unique.map(async (otherUserId) => {
        try {
          const rel = await this.getRelationship(userId, otherUserId);
          result.set(otherUserId, rel);
        } catch (e) {
          this.logger.warn(`getRelationship failed for ${userId} vs ${otherUserId}: ${e}`);
        }
      })
    );
    return result;
  }

  /**
   * Invalidate friendship cache for two users
   */
  private async invalidateFriendshipCache(userId1: string, userId2: string): Promise<void> {
    const [id1, id2] = [userId1, userId2].sort();
    const cacheKey = `friends:${id1}:${id2}`;
    await this.redis.del(cacheKey);
  }

  private async createFriendship(userId1: string, userId2: string): Promise<void> {
    const [id1, id2] = [userId1, userId2].sort();
    // Use upsert to prevent duplicate friendship errors if called concurrently
    await this.prisma.friend.upsert({
      where: {
        userId1_userId2: {
          userId1: id1,
          userId2: id2
        }
      },
      create: {
        userId1: id1,
        userId2: id2
      },
      update: {} // No update needed if exists
    });
  }

  private async removeFriendship(userId1: string, userId2: string): Promise<void> {
    const [id1, id2] = [userId1, userId2].sort();
    await this.prisma.friend.deleteMany({
      where: {
        userId1: id1,
        userId2: id2
      }
    });
    // Invalidate cache
    await this.invalidateFriendshipCache(userId1, userId2);
  }

  /**
   * Auto-create friendship (internal - for external users accepting squad invites)
   */
  async autoCreateFriendship(userId1: string, userId2: string): Promise<void> {
    if (userId1 === userId2) {
      throw new BadRequestException("Cannot create friendship with yourself");
    }

    // Check if already friends
    const areFriends = await this.areFriends(userId1, userId2);
    if (areFriends) {
      this.logger.log(`Users ${userId1} and ${userId2} are already friends`);
      return;
    }

    // Directly create friendship without going through friend request flow
    await this.createFriendship(userId1, userId2);
    
    // Move conversation to inbox if it exists
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
    
    // Invalidate friendship cache
    await this.invalidateFriendshipCache(userId1, userId2);
    
    this.metrics.incrementFriendshipCreated();
    this.logger.log(`Auto-created friendship between ${userId1} and ${userId2}`);
  }

  /**
   * Unfriend a user (remove friendship)
   */
  async unfriend(userId: string, friendId: string): Promise<void> {
    if (userId === friendId) {
      throw new BadRequestException("Cannot unfriend yourself");
    }

    // Verify they are friends
    const areFriends = await this.areFriends(userId, friendId);
    if (!areFriends) {
      throw new BadRequestException("Users are not friends");
    }

    // Remove friendship
    await this.removeFriendship(userId, friendId);

    this.metrics.incrementFriendshipRemoved();
    this.logger.log(`User ${userId} unfriended ${friendId}`);
    this.emitRealtimeConversationRefresh(userId, friendId, "unfriended");
  }

  /**
   * Cleanup expired requests (cron job - can be called periodically)
   */
  async cleanupExpiredRequests(): Promise<void> {
    const result = await this.prisma.friendRequest.updateMany({
      where: {
        status: "PENDING",
        expiresAt: {
          lt: new Date()
        }
      },
      data: {
        status: "CANCELLED"
      }
    });

    this.logger.log(`Cleaned up ${result.count} expired friend requests`);
  }

  /**
   * Get inbox conversations
   */
  async getInboxConversations(
    userId: string,
    limit: number = 50,
    cursor?: string,
    filter?: "text_only" | "with_gift" | "only_follows"
  ): Promise<{
    conversations: any[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    return await this.conversationService.getConversationsBySection(
      userId,
      ConversationSection.INBOX,
      limit,
      cursor,
      filter
    );
  }

  /**
   * Get received requests conversations
   */
  async getReceivedRequestsConversations(
    userId: string,
    limit: number = 50,
    cursor?: string,
    filter?: "text_only" | "with_gift" | "only_follows"
  ): Promise<{
    conversations: any[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    return await this.conversationService.getConversationsBySection(
      userId,
      ConversationSection.RECEIVED_REQUESTS,
      limit,
      cursor,
      filter
    );
  }

  /**
   * Get sent requests conversations
   */
  async getSentRequestsConversations(
    userId: string,
    limit: number = 50,
    cursor?: string,
    filter?: "text_only" | "with_gift" | "only_follows"
  ): Promise<{
    conversations: any[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    return await this.conversationService.getConversationsBySection(
      userId,
      ConversationSection.SENT_REQUESTS,
      limit,
      cursor,
      filter
    );
  }

  /**
   * Send message to conversation (unified endpoint)
   */
  async sendMessageToConversation(
    userId: string,
    conversationId: string,
    message: string | null,
    giftId?: string,
    giftAmount?: number,
    gif?: {
      provider: "giphy";
      id: string;
      url: string;
      previewUrl?: string;
      width?: number;
      height?: number;
    }
  ): Promise<{ messageId: string; newBalance?: number; promotedToInbox?: boolean }> {
    // Get conversation
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId }
    });

    if (!conversation) {
      throw new NotFoundException("Conversation not found");
    }

    // Determine other user
    const otherUserId = conversation.userId1 === userId ? conversation.userId2 : conversation.userId1;

    // Check if friends
    const areFriends = await this.areFriends(userId, otherUserId);

    if (areFriends) {
      return await this.sendMessageToFriend(userId, otherUserId, message, giftId, giftAmount, gif);
    } else {
      // Find friend request
      const request = await this.prisma.friendRequest.findFirst({
        where: {
          OR: [
            { fromUserId: userId, toUserId: otherUserId, status: "PENDING" },
            { fromUserId: otherUserId, toUserId: userId, status: "PENDING" }
          ]
        }
      });

      if (!request) {
        throw new NotFoundException("Friend request not found for this conversation");
      }

      // Determine which user is sender
      if (request.fromUserId === userId) {
        return await this.sendMessageToNonFriend(
          userId,
          otherUserId,
          message,
          request.id,
          giftId,
          giftAmount,
          gif
        );
      } else {
        // Reverse the request direction for the API
        const reverseRequest = await this.prisma.friendRequest.findFirst({
          where: {
            fromUserId: userId,
            toUserId: otherUserId,
            status: "PENDING"
          }
        });

        if (!reverseRequest) {
          // Create a pending request if it doesn't exist
          const newRequest = await this.prisma.friendRequest.create({
            data: {
              fromUserId: userId,
              toUserId: otherUserId,
              status: "PENDING"
            }
          });
          return await this.sendMessageToNonFriend(
            userId,
            otherUserId,
            message,
            newRequest.id,
            giftId,
            giftAmount,
            gif
          );
        }

        return await this.sendMessageToNonFriend(
          userId,
          otherUserId,
          message,
          reverseRequest.id,
          giftId,
          giftAmount,
          gif
        );
      }
    }
  }

  /**
   * Get messages for a conversation
   */
  async getConversationMessages(
    userId: string,
    conversationId: string,
    limit: number = 50,
    cursor?: string
  ): Promise<{
    messages: any[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    // Get conversation
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId }
    });

    if (!conversation) {
      throw new NotFoundException("Conversation not found");
    }

    // Verify user is part of conversation
    if (conversation.userId1 !== userId && conversation.userId2 !== userId) {
      throw new BadRequestException("You are not part of this conversation");
    }

    const otherUserId = conversation.userId1 === userId ? conversation.userId2 : conversation.userId1;

    return await this.getMessageHistory(userId, otherUserId, limit, cursor);
  }

  /**
   * Get service metrics
   */
  getMetrics() {
    return this.metrics.getMetrics();
  }

  /**
   * Mark a section as seen by updating lastSeenAt timestamp
   * Invalidates notification cache for the user
   */
  async markSectionAsSeen(userId: string, section: string): Promise<{ lastSeenAt: Date }> {
    try {
      const now = new Date();
      const result = await this.prisma.sectionLastSeen.upsert({
        where: {
          userId_section: {
            userId,
            section
          }
        },
        update: {
          lastSeenAt: now
        },
        create: {
          userId,
          section,
          lastSeenAt: now
        }
      });

      // Invalidate notification cache when section is marked as seen
      if (this.redis.isAvailable()) {
        const cacheKey = `notifications:${userId}`;
        await this.redis.del(cacheKey);
      }

      this.logger.log(`Section ${section} marked as seen for user ${userId} at ${now.toISOString()}`);
      return { lastSeenAt: result.lastSeenAt };
    } catch (error: any) {
      this.logger.error(`Failed to mark section ${section} as seen for user ${userId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get last seen timestamp for a section (returns null if never seen)
   */
  async getSectionLastSeen(userId: string, section: string): Promise<Date | null> {
    const lastSeen = await this.prisma.sectionLastSeen.findUnique({
      where: {
        userId_section: {
          userId,
          section
        }
      }
    });

    return lastSeen?.lastSeenAt || null;
  }

  /**
   * Invalidate notification cache for a user
   * Called when messages are sent/received or friend requests change
   */
  private async invalidateNotificationCache(userId: string): Promise<void> {
    if (this.redis.isAvailable()) {
      const cacheKey = `notifications:${userId}`;
      await this.redis.del(cacheKey);
      this.logger.debug(`Invalidated notification cache for user ${userId}`);
    }
  }

  /**
   * Get notification counts for unread messages and pending friend requests
   * Only counts items in sections that haven't been seen since items arrived
   * Uses Redis caching to reduce database load
   */
  async getNotificationCounts(userId: string): Promise<{
    hasNotifications: boolean;
    totalUnreadMessages: number;
    pendingFriendRequests: number;
    breakdown: {
      inbox: number;
      receivedRequests: number;
      sentRequests: number;
      friendRequests: number;
    };
  }> {
    const cacheKey = `notifications:${userId}`;

    try {
      // Try to get from cache first
      if (this.redis.isAvailable()) {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          this.logger.debug(`Notification counts cache hit for user ${userId}`);
          return JSON.parse(cached);
        }
      }

      // Optimize: Batch fetch all lastSeen records in a single query
      const lastSeenRecords = await this.prisma.sectionLastSeen.findMany({
        where: {
          userId,
          section: { in: ["INBOX", "RECEIVED_REQUESTS", "SENT_REQUESTS", "FRIEND_REQUESTS"] }
        }
      });

      // Create a Map for O(1) lookup
      const lastSeenMap = new Map<string, Date>();
      lastSeenRecords.forEach(record => {
        lastSeenMap.set(record.section, record.lastSeenAt);
      });

      const inboxLastSeen = lastSeenMap.get("INBOX") || null;
      const receivedLastSeen = lastSeenMap.get("RECEIVED_REQUESTS") || null;
      const sentLastSeen = lastSeenMap.get("SENT_REQUESTS") || null;
      const friendRequestsLastSeen = lastSeenMap.get("FRIEND_REQUESTS") || null;

      // Count unread messages by section (only those created after last seen).
      // Note: FriendMessage has no Conversation relation in schema; we count by matching
      // (fromUserId, toUserId) pairs that exist in Conversation for each section.
      const now = new Date();
      const inboxConvs = await this.prisma.conversation.findMany({
        where: {
          OR: [{ userId1: userId }, { userId2: userId }],
          section: ConversationSection.INBOX
        },
        select: { userId1: true, userId2: true }
      });
      const receivedConvs = await this.prisma.conversation.findMany({
        where: {
          OR: [{ userId1: userId }, { userId2: userId }],
          section: ConversationSection.RECEIVED_REQUESTS
        },
        select: { userId1: true, userId2: true }
      });
      const sentConvs = await this.prisma.conversation.findMany({
        where: {
          OR: [{ userId1: userId }, { userId2: userId }],
          section: ConversationSection.SENT_REQUESTS
        },
        select: { userId1: true, userId2: true }
      });
      const pair = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);
      const inboxPairs = new Set(inboxConvs.map((c) => pair(c.userId1, c.userId2)));
      const receivedPairs = new Set(receivedConvs.map((c) => pair(c.userId1, c.userId2)));
      const sentPairs = new Set(sentConvs.map((c) => pair(c.userId1, c.userId2)));

      const minLastSeen = Math.min(
        inboxLastSeen?.getTime() ?? 0,
        receivedLastSeen?.getTime() ?? 0,
        sentLastSeen?.getTime() ?? Infinity
      );
      const allUnread = await this.prisma.friendMessage.findMany({
        where: {
          toUserId: userId,
          isRead: false,
          createdAt: minLastSeen > 0 ? { gt: new Date(minLastSeen - 1000) } : undefined
        },
        select: { fromUserId: true, toUserId: true, createdAt: true }
      });
      let inboxCount = 0;
      let receivedCount = 0;
      let sentCount = 0;
      const inboxCutoff = inboxLastSeen ? inboxLastSeen.getTime() - 1000 : 0;
      const receivedCutoff = receivedLastSeen ? receivedLastSeen.getTime() - 1000 : 0;
      const sentCutoff = sentLastSeen ? sentLastSeen.getTime() - 1000 : 0;
      for (const m of allUnread) {
        const t = m.createdAt.getTime();
        const p = pair(m.fromUserId, m.toUserId);
        if (inboxPairs.has(p) && t > inboxCutoff) inboxCount++;
        else if (receivedPairs.has(p) && t > receivedCutoff) receivedCount++;
        else if (sentPairs.has(p) && t > sentCutoff) sentCount++;
      }

      // Count pending friend requests (only those created after last seen)
      const friendRequestsCount = await this.prisma.friendRequest.count({
        where: {
          toUserId: userId,
          status: "PENDING",
          createdAt: friendRequestsLastSeen 
            ? { gt: new Date(friendRequestsLastSeen.getTime() - 1000) } // 1 second buffer
            : undefined,
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: now } }
          ]
        }
      });

      const totalUnreadMessages = inboxCount + receivedCount + sentCount;
      const hasNotifications = totalUnreadMessages > 0 || friendRequestsCount > 0;

      const result = {
        hasNotifications,
        totalUnreadMessages,
        pendingFriendRequests: friendRequestsCount,
        breakdown: {
          inbox: inboxCount,
          receivedRequests: receivedCount,
          sentRequests: sentCount,
          friendRequests: friendRequestsCount
        }
      };

      // Cache the result
      if (this.redis.isAvailable()) {
        await this.redis.set(cacheKey, JSON.stringify(result), this.NOTIFICATION_COUNT_CACHE_TTL);
      }

      return result;
    } catch (error: any) {
      this.logger.error(`Failed to get notification counts for user ${userId}: ${error.message}`, error.stack);
      // Return safe default (no notifications) rather than failing
      return {
        hasNotifications: false,
        totalUnreadMessages: 0,
        pendingFriendRequests: 0,
        breakdown: {
          inbox: 0,
          receivedRequests: 0,
          sentRequests: 0,
          friendRequests: 0
        }
      };
    }
  }

  /**
   * Generate friends wall share image and return share data
   * This method will be called by the controller and orchestrate image generation
   * Note: This method should be moved to a separate service that handles image generation
   * For now, keeping it here as a placeholder - actual implementation will use FriendsWallImageService
   */
  async generateFriendsWallShare(_userId: string): Promise<{
    imageUrl: string;
    deepLink: string;
    productLink: string;
  }> {
    // This will be implemented by injecting FriendsWallImageService and FilesClientService
    // Placeholder for now
    throw new Error("This method should be implemented using FriendsWallImageService");
  }
}
