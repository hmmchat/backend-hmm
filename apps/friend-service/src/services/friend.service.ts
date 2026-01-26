import { Injectable, Logger, BadRequestException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { WalletClientService } from "./wallet-client.service.js";
import { RedisService } from "./redis.service.js";
import { MetricsService } from "./metrics.service.js";
import { ConversationService } from "./conversation.service.js";
import { GiftCatalogService } from "./gift-catalog.service.js";
import { UserClientService } from "./user-client.service.js";
import { MessageType, ConversationSection } from "@prisma/client";
import * as crypto from "crypto";

@Injectable()
export class FriendService {
  private readonly logger = new Logger(FriendService.name);
  private readonly REQUEST_EXPIRY_DAYS = parseInt(process.env.REQUEST_EXPIRY_DAYS || "30", 10);
  private readonly FIRST_MESSAGE_COST_COINS = parseInt(
    process.env.FIRST_MESSAGE_COST_COINS || "10",
    10
  );
  private readonly MAX_MESSAGE_LENGTH = 1000;
  private readonly SPAM_DETECTION_WINDOW = 60; // seconds
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
    private readonly userClient: UserClientService
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
    return await this.prisma.$transaction(async (tx) => {
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
      return { requestId: newRequest.id, autoAccepted: true };
    });
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

    this.logger.log(`Friend request ${requestId} accepted by ${userId}`);
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

    return messages.map(msg => ({
      id: msg.id,
      fromUserId: msg.fromUserId,
      toUserId: msg.toUserId,
      message: msg.message,
      isRead: msg.isRead,
      readAt: msg.readAt,
      transactionId: msg.transactionId,
      giftId: msg.giftId,
      giftAmount: msg.giftAmount,
      messageType: msg.messageType,
      createdAt: msg.createdAt
    }));
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
    giftAmount?: number
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

    // Validate message length
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

    // Determine message type
    let messageType: MessageType = MessageType.TEXT;
    if (giftId && !message) {
      messageType = MessageType.GIFT;
    } else if (giftId && message) {
      messageType = MessageType.GIFT_WITH_MESSAGE;
    }

    // CRITICAL: Validate gift if provided
    if (giftId) {
      if (!giftAmount) {
        throw new BadRequestException("Gift amount is required when sending a gift");
      }
      await this.giftCatalog.validateGift(giftId, giftAmount);
    }

    // Determine if we need to charge for message
    const needsPayment = !giftId && isFirstMessage;
    const cost = needsPayment ? this.FIRST_MESSAGE_COST_COINS : 0;

    // Check if subsequent message without gift (not allowed)
    if (!isFirstMessage && !giftId && message) {
      throw new BadRequestException(
        "Subsequent messages require a gift. Please send a gift with your message."
      );
    }

    // CRITICAL: Use transaction to ensure atomicity
    return await this.prisma.$transaction(async (tx) => {
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
        // Transfer coins for gift
        const result = await this.walletClient.transferCoins(
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
          transactionId,
          giftId: giftId || null,
          giftAmount: giftAmount || null,
          messageType
        }
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
      this.logger.log(
        `Message sent from ${fromUserId} to non-friend ${toUserId} ` +
        `(type: ${messageType}, cost: ${cost || giftAmount || 0} coins)`
      );

      return {
        messageId: friendMessage.id,
        newBalance,
        promotedToInbox: wasPromoted || undefined
      };
    });
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
    giftAmount?: number
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

    // Validate message length
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

    // Determine message type
    let messageType: MessageType = MessageType.TEXT;
    if (giftId && !message) {
      messageType = MessageType.GIFT;
    } else if (giftId && message) {
      messageType = MessageType.GIFT_WITH_MESSAGE;
    }

    // Use transaction for atomicity
    return await this.prisma.$transaction(async (tx) => {
      let transactionId: string | undefined;
      let newBalance: number | undefined;

      // If gift is sent, transfer coins
      if (giftId && giftAmount) {
        const result = await this.walletClient.transferCoins(
          fromUserId,
          toUserId,
          giftAmount,
          `Gift to friend ${toUserId}`,
          giftId
        );
        transactionId = result.transactionId;
        newBalance = result.newBalance;
      }

      // Create message (free for friends, but gift costs coins)
      const friendMessage = await tx.friendMessage.create({
        data: {
          fromUserId,
          toUserId,
          message: message || null,
          transactionId,
          giftId: giftId || null,
          giftAmount: giftAmount || null,
          messageType
        }
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
        `(type: ${messageType}${giftAmount ? `, gift: ${giftAmount} coins` : ""})`
      );

      return {
        messageId: friendMessage.id,
        newBalance
      };
    });
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
    const messages = await this.prisma.friendMessage.findMany({
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

    const hasMore = messages.length > limit;
    const resultMessages = hasMore ? messages.slice(0, limit) : messages;
    const nextCursor = hasMore ? resultMessages[resultMessages.length - 1].id : undefined;

    return {
      messages: resultMessages.reverse().map(msg => ({
        id: msg.id,
        fromUserId: msg.fromUserId,
        toUserId: msg.toUserId,
        message: msg.message,
        isRead: msg.isRead,
        readAt: msg.readAt,
        transactionId: msg.transactionId, // Shows if message cost coins
        giftId: msg.giftId,
        giftAmount: msg.giftAmount,
        messageType: msg.messageType,
        createdAt: msg.createdAt
      })),
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
    cursor?: string
  ): Promise<{
    conversations: any[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    return await this.conversationService.getConversationsBySection(
      userId,
      ConversationSection.INBOX,
      limit,
      cursor
    );
  }

  /**
   * Get received requests conversations
   */
  async getReceivedRequestsConversations(
    userId: string,
    limit: number = 50,
    cursor?: string
  ): Promise<{
    conversations: any[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    return await this.conversationService.getConversationsBySection(
      userId,
      ConversationSection.RECEIVED_REQUESTS,
      limit,
      cursor
    );
  }

  /**
   * Get sent requests conversations
   */
  async getSentRequestsConversations(
    userId: string,
    limit: number = 50,
    cursor?: string
  ): Promise<{
    conversations: any[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    return await this.conversationService.getConversationsBySection(
      userId,
      ConversationSection.SENT_REQUESTS,
      limit,
      cursor
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
    giftAmount?: number
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
      return await this.sendMessageToFriend(userId, otherUserId, message, giftId, giftAmount);
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
          giftAmount
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
            giftAmount
          );
        }

        return await this.sendMessageToNonFriend(
          userId,
          otherUserId,
          message,
          reverseRequest.id,
          giftId,
          giftAmount
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
}
