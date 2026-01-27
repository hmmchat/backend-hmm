import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
  HttpException,
  HttpStatus,
  Query,
  Param,
  UseGuards
} from "@nestjs/common";
import { FriendService } from "../services/friend.service.js";
import { RateLimitGuard } from "../guards/rate-limit.guard.js";
import { ConversationRateLimitGuard } from "../guards/conversation-rate-limit.guard.js";
import { z } from "zod";
import { verifyToken, AccessPayload } from "@hmm/common";
import { JWK } from "jose";

const SendMessageSchema = z.object({
  message: z.string().max(1000).nullable().optional().transform((val) => {
    // Convert empty strings to null
    if (val === "" || val === null || val === undefined) return null;
    return val;
  }),
  giftId: z.string().optional(),
  giftAmount: z.number().positive().optional()
}).refine(
  (data) => {
    // Either message (non-empty) or giftId must be provided
    const hasMessage = data.message && data.message.trim().length > 0;
    const hasGift = data.giftId && data.giftId.trim().length > 0;
    return hasMessage || hasGift;
  },
  { message: "Either message or giftId must be provided" }
);

const PaginationSchema = z.object({
  limit: z.string().optional().transform((val) => val ? Math.min(parseInt(val, 10), 100) : 50), // Max 100
  cursor: z.string().optional()
});

const ConversationFilterSchema = z.enum(["text_only", "with_gift", "only_follows"], {
  errorMap: () => ({ message: "Filter must be one of: text_only, with_gift, or only_follows" })
});

const ConversationQuerySchema = PaginationSchema.extend({
  filter: ConversationFilterSchema.optional()
});

@Controller()
export class FriendController {
  private verifyAccess!: (token: string) => Promise<AccessPayload>;
  private publicJwk!: JWK;
  private jwtInitialized = false;

  constructor(private readonly friendService: FriendService) {}

  private async initializeJWT() {
    if (this.jwtInitialized) return;
    
    const jwkStr = process.env.JWT_PUBLIC_JWK;
    if (!jwkStr || jwkStr === "undefined") {
      throw new Error("JWT_PUBLIC_JWK environment variable is not set or is invalid");
    }
    const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
    this.publicJwk = JSON.parse(cleanedJwk) as JWK;
    this.verifyAccess = await verifyToken(this.publicJwk);
    this.jwtInitialized = true;
  }

  private getTokenFromHeader(h?: string): string | null {
    if (!h) return null;
    const [t, v] = h.split(" ");
    return t?.toLowerCase() === "bearer" ? v : null;
  }

  private async verifyTokenAndGetUserId(token: string): Promise<string> {
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }
    await this.initializeJWT();
    const payload = await this.verifyAccess(token);
    return payload.sub;
  }

  private verifyInternalServiceToken(serviceToken: string | undefined): void {
    const isTestMode = process.env.NODE_ENV === "test" || process.env.TEST_MODE === "true";
    const expectedToken = process.env.INTERNAL_SERVICE_TOKEN;
    if (!isTestMode) {
      if (!expectedToken) {
        throw new HttpException(
          "Internal service token not configured",
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      }
      if (serviceToken !== expectedToken) {
        throw new HttpException("Invalid service token", HttpStatus.UNAUTHORIZED);
      }
    }
  }

  // NOTE: Friend requests can ONLY be sent during video calls via the "+" button
  // OR from OFFLINE cards section (new feature)
  // All other friend requests must go through the streaming-service WebSocket handler
  // See: /internal/friends/requests (internal endpoint called by streaming-service)

  /**
   * Get pending requests (incoming)
   * GET /me/friends/requests/pending
   */
  @Get("me/friends/requests/pending")
  async getPendingRequests(@Headers("authorization") authz?: string) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    return this.friendService.getPendingRequests(userId);
  }

  /**
   * Get sent requests (outgoing)
   * GET /me/friends/requests/sent
   */
  @Get("me/friends/requests/sent")
  async getSentRequests(@Headers("authorization") authz?: string) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    return this.friendService.getSentRequests(userId);
  }

  /**
   * Get messages for a pending request
   * GET /me/friends/requests/:requestId/messages
   */
  @Get("me/friends/requests/:requestId/messages")
  async getRequestMessages(
    @Headers("authorization") authz: string,
    @Param("requestId") requestId: string
  ) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    return this.friendService.getRequestMessages(requestId, userId);
  }

  /**
   * Accept friend request
   * POST /me/friends/requests/:requestId/accept
   */
  @Post("me/friends/requests/:requestId/accept")
  async acceptRequest(
    @Headers("authorization") authz: string,
    @Param("requestId") requestId: string
  ) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    await this.friendService.acceptFriendRequest(requestId, userId);
    return { ok: true };
  }

  /**
   * Reject friend request
   * POST /me/friends/requests/:requestId/reject
   */
  @Post("me/friends/requests/:requestId/reject")
  async rejectRequest(
    @Headers("authorization") authz: string,
    @Param("requestId") requestId: string
  ) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    await this.friendService.rejectFriendRequest(requestId, userId);
    return { ok: true };
  }

  /**
   * Send friend request from OFFLINE cards section
   * POST /me/friends/offline-cards/request
   * This is the ONLY public endpoint for sending friend requests (besides video calls)
   */
  @Post("me/friends/offline-cards/request")
  async sendFriendRequestFromOfflineCard(
    @Headers("authorization") authz: string,
    @Body() body: any
  ) {
    const token = this.getTokenFromHeader(authz);
    const fromUserId = await this.verifyTokenAndGetUserId(token!);

    const schema = z.object({
      toUserId: z.string().min(1, "toUserId is required")
    });
    const { toUserId } = schema.parse(body);

    const result = await this.friendService.sendFriendRequest(fromUserId, toUserId);
    return {
      ok: true,
      requestId: result.requestId,
      autoAccepted: result.autoAccepted
    };
  }

  /**
   * Get all friends with pagination
   * GET /me/friends
   * Query params: ?limit=50&cursor=xxx
   */
  @Get("me/friends")
  async getFriends(
    @Headers("authorization") authz?: string,
    @Query() query?: any
  ) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    const limit = query?.limit ? parseInt(query.limit, 10) : 50;
    const cursor = query?.cursor;
    return this.friendService.getFriends(userId, limit, cursor);
  }

  /**
   * Get friends wall - paginated friends with profile photos
   * GET /me/friends/wall
   * Query params: ?limit=35&cursor=xxx
   * Returns friends with displayPictureUrl for grid display
   */
  @Get("me/friends/wall")
  async getFriendsWall(
    @Headers("authorization") authz?: string,
    @Query() query?: any
  ) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    const limit = query?.limit ? parseInt(query.limit, 10) : undefined;
    const cursor = query?.cursor;
    return this.friendService.getFriendsWall(userId, limit, cursor);
  }

  /**
   * Send message to friend (free, supports gifts)
   * POST /me/friends/:friendId/messages
   */
  @Post("me/friends/:friendId/messages")
  @UseGuards(RateLimitGuard)
  async sendMessageToFriend(
    @Headers("authorization") authz: string,
    @Param("friendId") friendId: string,
    @Body() body: any
  ) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    const dto = SendMessageSchema.parse(body);
    return this.friendService.sendMessageToFriend(
      userId,
      friendId,
      dto.message || null,
      dto.giftId,
      dto.giftAmount
    );
  }

  /**
   * Send message to non-friend (costs coins, supports gifts)
   * POST /me/friends/requests/:requestId/messages
   */
  @Post("me/friends/requests/:requestId/messages")
  @UseGuards(RateLimitGuard)
  async sendMessageToNonFriend(
    @Headers("authorization") authz: string,
    @Param("requestId") requestId: string,
    @Body() body: any
  ) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    const dto = SendMessageSchema.parse(body);
    const request = await this.friendService.getRequest(requestId);
    return this.friendService.sendMessageToNonFriend(
      userId,
      request.toUserId,
      dto.message || null,
      requestId,
      dto.giftId,
      dto.giftAmount
    );
  }

  /**
   * Get message history with a friend
   * GET /me/friends/:friendId/messages
   */
  @Get("me/friends/:friendId/messages")
  async getMessageHistory(
    @Headers("authorization") authz: string,
    @Param("friendId") friendId: string,
    @Query() query: any
  ) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    const pagination = PaginationSchema.parse(query);
    return this.friendService.getMessageHistory(userId, friendId, pagination.limit, pagination.cursor);
  }

  /**
   * Get inbox conversations
   * GET /me/conversations/inbox
   */
  @UseGuards(ConversationRateLimitGuard)
  @Get("me/conversations/inbox")
  async getInboxConversations(
    @Headers("authorization") authz: string,
    @Query() query: any
  ) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    const pagination = PaginationSchema.parse(query);
    return this.friendService.getInboxConversations(userId, pagination.limit, pagination.cursor);
  }

  /**
   * Get received requests conversations
   * GET /me/conversations/received-requests?filter=text_only|with_gift|only_follows
   */
  @UseGuards(ConversationRateLimitGuard)
  @Get("me/conversations/received-requests")
  async getReceivedRequestsConversations(
    @Headers("authorization") authz: string,
    @Query() query: any
  ) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    const parsed = ConversationQuerySchema.parse(query);
    return this.friendService.getReceivedRequestsConversations(
      userId,
      parsed.limit,
      parsed.cursor,
      parsed.filter
    );
  }

  /**
   * Get sent requests conversations
   * GET /me/conversations/sent-requests?filter=text_only|with_gift|only_follows
   */
  @UseGuards(ConversationRateLimitGuard)
  @Get("me/conversations/sent-requests")
  async getSentRequestsConversations(
    @Headers("authorization") authz: string,
    @Query() query: any
  ) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    const parsed = ConversationQuerySchema.parse(query);
    return this.friendService.getSentRequestsConversations(
      userId,
      parsed.limit,
      parsed.cursor,
      parsed.filter
    );
  }

  /**
   * Send message via conversation ID
   * POST /me/conversations/:conversationId/messages
   */
  @Post("me/conversations/:conversationId/messages")
  @UseGuards(RateLimitGuard)
  async sendMessageToConversation(
    @Headers("authorization") authz: string,
    @Param("conversationId") conversationId: string,
    @Body() body: any
  ) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    const dto = SendMessageSchema.parse(body);
    return this.friendService.sendMessageToConversation(
      userId,
      conversationId,
      dto.message || null,
      dto.giftId,
      dto.giftAmount
    );
  }

  /**
   * Get messages for a conversation
   * GET /me/conversations/:conversationId/messages
   */
  @Get("me/conversations/:conversationId/messages")
  async getConversationMessages(
    @Headers("authorization") authz: string,
    @Param("conversationId") conversationId: string,
    @Query() query: any
  ) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    const pagination = PaginationSchema.parse(query);
    return this.friendService.getConversationMessages(userId, conversationId, pagination.limit, pagination.cursor);
  }

  /**
   * Mark messages as read
   * POST /me/friends/:friendId/messages/read
   */
  @Post("me/friends/:friendId/messages/read")
  async markMessagesAsRead(
    @Headers("authorization") authz: string,
    @Param("friendId") friendId: string
  ) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    await this.friendService.markMessagesAsRead(userId, friendId);
    return { ok: true };
  }

  /**
   * Unfriend a user
   * POST /me/friends/:friendId/unfriend
   */
  @Post("me/friends/:friendId/unfriend")
  async unfriend(
    @Headers("authorization") authz: string,
    @Param("friendId") friendId: string
  ) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    await this.friendService.unfriend(userId, friendId);
    return { ok: true };
  }

  /**
   * Block a user
   * POST /me/friends/:friendId/block
   */
  @Post("me/friends/:friendId/block")
  async blockUser(
    @Headers("authorization") authz: string,
    @Param("friendId") friendId: string
  ) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    await this.friendService.blockUser(userId, friendId);
    return { ok: true };
  }

  /**
   * Get service metrics (for monitoring)
   * GET /internal/metrics
   */
  @Get("internal/metrics")
  async getMetrics(@Headers("x-service-token") serviceToken?: string) {
    // Optional: Add service token validation for production
    const expectedToken = process.env.INTERNAL_SERVICE_TOKEN;
    if (expectedToken && serviceToken !== expectedToken) {
      throw new HttpException("Invalid service token", HttpStatus.UNAUTHORIZED);
    }

    return this.friendService.getMetrics();
  }

  /* ---------- Internal/Service Endpoints (No Auth Required) ---------- */

  /**
   * Send friend request during call (called by streaming-service)
   * POST /internal/friends/requests
   * Requires service authentication token
   */
  @Post("internal/friends/requests")
  async sendFriendRequestDuringCall(
    @Headers("x-service-token") serviceToken: string | undefined,
    @Body() body: any
  ) {
    // Verify service token for internal endpoint security
    // In test mode, allow requests without token
    const isTestMode = process.env.NODE_ENV === "test" || process.env.TEST_MODE === "true";
    const expectedToken = process.env.INTERNAL_SERVICE_TOKEN;
    
    if (!isTestMode) {
      if (!expectedToken) {
        throw new HttpException(
          "Internal service token not configured",
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      }

      if (serviceToken !== expectedToken) {
        throw new HttpException(
          "Invalid service token",
          HttpStatus.UNAUTHORIZED
        );
      }
    }

    const { fromUserId, toUserId } = z.object({
      fromUserId: z.string(),
      toUserId: z.string(),
      roomId: z.string().optional()
    }).parse(body);

    const result = await this.friendService.sendFriendRequest(fromUserId, toUserId);
    return {
      ok: true,
      requestId: result.requestId,
      autoAccepted: result.autoAccepted
    };
  }

  /**
   * Check if two users are friends (internal endpoint)
   * GET /internal/friends/check?userId1=xxx&userId2=xxx
   */
  @Get("internal/friends/check")
  async checkFriendship(
    @Headers("x-service-token") serviceToken: string | undefined,
    @Query() query: any
  ) {
    this.verifyInternalServiceToken(serviceToken);
    const { userId1, userId2 } = z.object({
      userId1: z.string(),
      userId2: z.string()
    }).parse(query);

    // Check friendship using friend service method
    const areFriends = await this.friendService.areFriends(userId1, userId2);
    
    return {
      areFriends
    };
  }

  /**
   * Get relationship for History Hotline (internal)
   * GET /internal/friends/relationship?userId=xxx&otherUserId=xxx
   */
  @Get("internal/friends/relationship")
  async getRelationship(
    @Headers("x-service-token") serviceToken: string | undefined,
    @Query() query: any
  ) {
    this.verifyInternalServiceToken(serviceToken);
    const { userId, otherUserId } = z
      .object({ userId: z.string(), otherUserId: z.string() })
      .parse(query);
    return this.friendService.getRelationship(userId, otherUserId);
  }

  /**
   * Get relationships batch for History (internal)
   * POST /internal/friends/relationships
   * Body: { userId: string, otherUserIds: string[] }
   */
  @Post("internal/friends/relationships")
  async getRelationshipsBatch(
    @Headers("x-service-token") serviceToken: string | undefined,
    @Body() body: any
  ) {
    this.verifyInternalServiceToken(serviceToken);
    const { userId, otherUserIds } = z
      .object({
        userId: z.string(),
        otherUserIds: z.array(z.string())
      })
      .parse(body);
    const map = await this.friendService.getRelationshipsBatch(userId, otherUserIds);
    return Object.fromEntries(map);
  }

  /* ---------- Test Endpoints (No Auth Required) ---------- */

  /**
   * Test endpoint: Get friends (bypasses auth)
   * GET /test/friends?userId=xxx&limit=50&cursor=xxx
   */
  @Get("test/friends")
  async getFriendsTest(@Query() query: any) {
    const userId = query.userId;
    if (!userId) {
      throw new HttpException("userId is required", HttpStatus.BAD_REQUEST);
    }
    const limit = query.limit ? parseInt(query.limit, 10) : 50;
    const cursor = query.cursor;
    return this.friendService.getFriends(userId, limit, cursor);
  }

  /**
   * Test endpoint: Get pending requests (bypasses auth)
   * GET /test/friends/requests/pending?userId=xxx
   */
  @Get("test/friends/requests/pending")
  async getPendingRequestsTest(@Query("userId") userId: string) {
    if (!userId) {
      throw new HttpException("userId is required", HttpStatus.BAD_REQUEST);
    }
    return this.friendService.getPendingRequests(userId);
  }

  /**
   * Test endpoint: Get sent requests (bypasses auth)
   * GET /test/friends/requests/sent?userId=xxx
   */
  @Get("test/friends/requests/sent")
  async getSentRequestsTest(@Query("userId") userId: string) {
    if (!userId) {
      throw new HttpException("userId is required", HttpStatus.BAD_REQUEST);
    }
    return this.friendService.getSentRequests(userId);
  }

  /**
   * Test endpoint: Send friend request (bypasses auth)
   * POST /test/friends/requests
   */
  @Post("test/friends/requests")
  async sendFriendRequestTest(@Body() body: any) {
    const { fromUserId, toUserId } = z.object({
      fromUserId: z.string(),
      toUserId: z.string()
    }).parse(body);
    const result = await this.friendService.sendFriendRequest(fromUserId, toUserId);
    return {
      ok: true,
      requestId: result.requestId,
      autoAccepted: result.autoAccepted
    };
  }

  /**
   * Test endpoint: Accept friend request (bypasses auth)
   * POST /test/friends/requests/:requestId/accept
   */
  @Post("test/friends/requests/:requestId/accept")
  async acceptRequestTest(@Param("requestId") requestId: string, @Query("userId") userId: string) {
    if (!userId) {
      throw new HttpException("userId is required", HttpStatus.BAD_REQUEST);
    }
    await this.friendService.acceptFriendRequest(requestId, userId);
    return { ok: true };
  }

  /**
   * Test endpoint: Reject friend request (bypasses auth)
   * POST /test/friends/requests/:requestId/reject
   */
  @Post("test/friends/requests/:requestId/reject")
  async rejectRequestTest(@Param("requestId") requestId: string, @Query("userId") userId: string) {
    if (!userId) {
      throw new HttpException("userId is required", HttpStatus.BAD_REQUEST);
    }
    await this.friendService.rejectFriendRequest(requestId, userId);
    return { ok: true };
  }

  /**
   * Auto-create friendship (internal endpoint - for external users accepting squad invites)
   * POST /internal/friends/auto-create
   */
  @Post("internal/friends/auto-create")
  async autoCreateFriendship(
    @Headers("x-service-token") serviceToken: string | undefined,
    @Body() body: any
  ) {
    // Verify service token
    // In test mode, allow requests without token
    const isTestMode = process.env.NODE_ENV === "test" || process.env.TEST_MODE === "true";
    const expectedToken = process.env.INTERNAL_SERVICE_TOKEN;
    
    if (!isTestMode) {
      if (!expectedToken) {
        throw new HttpException(
          "Internal service token not configured",
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      }

      if (serviceToken !== expectedToken) {
        throw new HttpException(
          "Invalid service token",
          HttpStatus.UNAUTHORIZED
        );
      }
    }

    const { userId1, userId2 } = z.object({
      userId1: z.string(),
      userId2: z.string()
    }).parse(body);

    // Auto-create friendship directly
    try {
      await this.friendService.autoCreateFriendship(userId1, userId2);
      return {
        ok: true,
        message: "Friendship created successfully"
      };
    } catch (error: any) {
      // If already friends, return success
      if (error.message?.includes("already friends")) {
        return {
          ok: true,
          message: "Users are already friends"
        };
      }
      throw error;
    }
  }

  /**
   * Get friends list (internal endpoint)
   * GET /internal/friends?userId=xxx&limit=50
   */
  @Get("internal/friends")
  async getFriendsInternal(
    @Headers("x-service-token") serviceToken: string | undefined,
    @Query() query: any
  ) {
    // Verify service token
    // In test mode, allow requests without token
    const isTestMode = process.env.NODE_ENV === "test" || process.env.TEST_MODE === "true";
    const expectedToken = process.env.INTERNAL_SERVICE_TOKEN;
    
    if (!isTestMode) {
      if (!expectedToken) {
        throw new HttpException(
          "Internal service token not configured",
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      }

      if (serviceToken !== expectedToken) {
        throw new HttpException(
          "Invalid service token",
          HttpStatus.UNAUTHORIZED
        );
      }
    }

    const { userId, limit } = z.object({
      userId: z.string(),
      limit: z.string().optional().transform((val) => val ? parseInt(val, 10) : 50)
    }).parse(query);

    const result = await this.friendService.getFriends(userId, limit || 50);
    
    return {
      friends: result.friends
    };
  }

  /* ---------- Test Endpoints for Messaging (No Auth Required) ---------- */

  /**
   * Test endpoint: Get inbox conversations (bypasses auth)
   * GET /test/conversations/inbox?userId=xxx&limit=50&cursor=xxx
   */
  @Get("test/conversations/inbox")
  async getInboxConversationsTest(@Query() query: any) {
    const userId = query.userId;
    if (!userId) {
      throw new HttpException("userId is required", HttpStatus.BAD_REQUEST);
    }
    const limit = query.limit ? Math.min(parseInt(query.limit, 10), 100) : 50;
    const cursor = query.cursor;
    return this.friendService.getInboxConversations(userId, limit, cursor);
  }

  /**
   * Test endpoint: Get received requests conversations (bypasses auth)
   * GET /test/conversations/received-requests?userId=xxx&limit=50&cursor=xxx&filter=text_only|with_gift|only_follows
   */
  @Get("test/conversations/received-requests")
  async getReceivedRequestsConversationsTest(@Query() query: any) {
    const userId = query.userId;
    if (!userId) {
      throw new HttpException("userId is required", HttpStatus.BAD_REQUEST);
    }
    const limit = query.limit ? Math.min(parseInt(query.limit, 10), 100) : 50;
    const cursor = query.cursor;
    const filter = query.filter;
    return this.friendService.getReceivedRequestsConversations(userId, limit, cursor, filter);
  }

  /**
   * Test endpoint: Get sent requests conversations (bypasses auth)
   * GET /test/conversations/sent-requests?userId=xxx&limit=50&cursor=xxx&filter=text_only|with_gift|only_follows
   */
  @Get("test/conversations/sent-requests")
  async getSentRequestsConversationsTest(@Query() query: any) {
    const userId = query.userId;
    if (!userId) {
      throw new HttpException("userId is required", HttpStatus.BAD_REQUEST);
    }
    const limit = query.limit ? Math.min(parseInt(query.limit, 10), 100) : 50;
    const cursor = query.cursor;
    const filter = query.filter;
    return this.friendService.getSentRequestsConversations(userId, limit, cursor, filter);
  }

  /**
   * Test endpoint: Send message to friend request (bypasses auth)
   * POST /test/friends/requests/:requestId/messages?fromUserId=xxx
   */
  @Post("test/friends/requests/:requestId/messages")
  async sendMessageToNonFriendTest(
    @Param("requestId") requestId: string,
    @Query("fromUserId") fromUserId: string,
    @Body() body: any
  ) {
    if (!fromUserId) {
      throw new HttpException("fromUserId is required", HttpStatus.BAD_REQUEST);
    }
    const request = await this.friendService.getRequest(requestId);
    const dto = SendMessageSchema.parse(body);
    return this.friendService.sendMessageToNonFriend(
      fromUserId,
      request.toUserId,
      dto.message || null,
      requestId,
      dto.giftId,
      dto.giftAmount
    );
  }

  /**
   * Test endpoint: Send message to friend (bypasses auth)
   * POST /test/friends/:friendId/messages?fromUserId=xxx
   */
  @Post("test/friends/:friendId/messages")
  async sendMessageToFriendTest(
    @Param("friendId") friendId: string,
    @Query("fromUserId") fromUserId: string,
    @Body() body: any
  ) {
    if (!fromUserId) {
      throw new HttpException("fromUserId is required", HttpStatus.BAD_REQUEST);
    }
    const dto = SendMessageSchema.parse(body);
    return this.friendService.sendMessageToFriend(
      fromUserId,
      friendId,
      dto.message || null,
      dto.giftId,
      dto.giftAmount
    );
  }

  /**
   * Test endpoint: Get conversation messages (bypasses auth)
   * GET /test/conversations/:conversationId/messages?userId=xxx&limit=50&cursor=xxx
   */
  @Get("test/conversations/:conversationId/messages")
  async getConversationMessagesTest(
    @Param("conversationId") conversationId: string,
    @Query() query: any
  ) {
    const userId = query.userId;
    if (!userId) {
      throw new HttpException("userId is required", HttpStatus.BAD_REQUEST);
    }
    const limit = query.limit ? Math.min(parseInt(query.limit, 10), 100) : 50;
    const cursor = query.cursor;
    return this.friendService.getConversationMessages(userId, conversationId, limit, cursor);
  }
}
