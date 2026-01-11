import { Injectable, Logger, BadRequestException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { WalletClientService } from "./wallet-client.service.js";
import { RedisService } from "./redis.service.js";
import { MetricsService } from "./metrics.service.js";

@Injectable()
export class FriendService {
  private readonly logger = new Logger(FriendService.name);
  private readonly REQUEST_EXPIRY_DAYS = parseInt(process.env.REQUEST_EXPIRY_DAYS || "30", 10);
  private readonly MESSAGE_COST_COINS = parseInt(
    process.env.MESSAGE_COST_COINS || "10",
    10
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletClient: WalletClientService,
    private readonly redis: RedisService,
    private readonly metrics: MetricsService
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
      createdAt: msg.createdAt
    }));
  }

  /**
   * Send message to non-friend (costs 10 coins per message - unlimited messages)
   * This is a revenue source - users can send as many messages as they want
   */
  async sendMessageToNonFriend(
    fromUserId: string,
    toUserId: string,
    message: string,
    requestId: string // Friend request ID
  ): Promise<{ messageId: string; newBalance: number }> {
    if (fromUserId === toUserId) {
      throw new BadRequestException("Cannot send message to yourself");
    }

    // Verify request exists and is pending
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

    // Deduct coins from wallet and create message
    // If message creation fails, we can't rollback wallet transaction,
    // but we log it for manual reconciliation
    let transactionId: string | undefined;
    let newBalance: number;

    try {
      // Step 1: Deduct coins from wallet
      const result = await this.walletClient.deductCoins(
        fromUserId,
        this.MESSAGE_COST_COINS,
        `Message to non-friend: ${toUserId}`
      );
      transactionId = result.transactionId;
      newBalance = result.newBalance;

      // Step 2: Create message in database
      // If this fails, we've already deducted coins, so we log for reconciliation
      const friendMessage = await this.prisma.friendMessage.create({
        data: {
          fromUserId,
          toUserId,
          message,
          transactionId
        }
      });

      this.metrics.incrementMessageSentToNonFriend();
      this.logger.log(
        `Message sent from ${fromUserId} to non-friend ${toUserId} ` +
        `(cost: ${this.MESSAGE_COST_COINS} coins, balance: ${newBalance})`
      );

      return { messageId: friendMessage.id, newBalance };
    } catch (error: any) {
      // If wallet deduction succeeded but message creation failed,
      // log for manual reconciliation (wallet-service should have transaction record)
      if (transactionId) {
        this.logger.error(
          `CRITICAL: Wallet deduction succeeded (tx: ${transactionId}) but message creation failed. ` +
          `User ${fromUserId} lost ${this.MESSAGE_COST_COINS} coins. Manual reconciliation required.`,
          error
        );
      }

      if (error.message?.includes("Insufficient balance") || error.message?.includes("Failed to deduct coins")) {
        this.metrics.incrementWalletDeductionFailed();
        throw new BadRequestException(
          `Insufficient coins to send message. Required: ${this.MESSAGE_COST_COINS} coins`
        );
      }
      this.metrics.incrementMessageSendFailed();
      throw error;
    }
  }

  /**
   * Send message to friend (free - unlimited messages)
   */
  async sendMessageToFriend(
    fromUserId: string,
    toUserId: string,
    message: string
  ): Promise<{ messageId: string }> {
    if (fromUserId === toUserId) {
      throw new BadRequestException("Cannot send message to yourself");
    }

    // Verify friendship
    const areFriends = await this.areFriends(fromUserId, toUserId);
    if (!areFriends) {
      throw new BadRequestException("Users are not friends");
    }

    // Create message (persisted in database - no cost for friends)
    const friendMessage = await this.prisma.friendMessage.create({
      data: {
        fromUserId,
        toUserId,
        message
        // No transactionId - free for friends
      }
    });

    this.metrics.incrementMessageSentToFriend();
    this.logger.log(`Message sent from ${fromUserId} to friend ${toUserId} (free)`);
    return { messageId: friendMessage.id };
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
   * Get service metrics
   */
  getMetrics() {
    return this.metrics.getMetrics();
  }
}
