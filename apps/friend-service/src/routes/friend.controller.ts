import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
  HttpException,
  HttpStatus,
  Query,
  Param
} from "@nestjs/common";
import { FriendService } from "../services/friend.service.js";
import { z } from "zod";
import { verifyToken, AccessPayload } from "@hmm/common";
import { JWK } from "jose";

const SendMessageSchema = z.object({
  message: z.string().min(1).max(1000)
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

  // NOTE: Friend requests can ONLY be sent during video calls via the "+" button
  // There is no public endpoint for users to send friend requests directly
  // All friend requests must go through the streaming-service WebSocket handler
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
   * Send message to friend (free)
   * POST /me/friends/:friendId/messages
   */
  @Post("me/friends/:friendId/messages")
  async sendMessageToFriend(
    @Headers("authorization") authz: string,
    @Param("friendId") friendId: string,
    @Body() body: any
  ) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    const dto = SendMessageSchema.parse(body);
    return this.friendService.sendMessageToFriend(userId, friendId, dto.message);
  }

  /**
   * Send message to non-friend (costs coins)
   * POST /me/friends/requests/:requestId/messages
   */
  @Post("me/friends/requests/:requestId/messages")
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
      dto.message,
      requestId
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
    const limit = query.limit ? parseInt(query.limit, 10) : 50;
    const cursor = query.cursor;
    return this.friendService.getMessageHistory(userId, friendId, limit, cursor);
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
    @Headers("x-service-token") serviceToken: string,
    @Body() body: any
  ) {
    // Verify service token for internal endpoint security
    const expectedToken = process.env.INTERNAL_SERVICE_TOKEN;
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

    const { fromUserId, toUserId, roomId } = z.object({
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
    @Headers("x-service-token") serviceToken: string,
    @Query() query: any
  ) {
    // Verify service token
    const expectedToken = process.env.INTERNAL_SERVICE_TOKEN;
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
   * Auto-create friendship (internal endpoint - for external users accepting squad invites)
   * POST /internal/friends/auto-create
   */
  @Post("internal/friends/auto-create")
  async autoCreateFriendship(
    @Headers("x-service-token") serviceToken: string,
    @Body() body: any
  ) {
    // Verify service token
    const expectedToken = process.env.INTERNAL_SERVICE_TOKEN;
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
    @Headers("x-service-token") serviceToken: string,
    @Query() query: any
  ) {
    // Verify service token
    const expectedToken = process.env.INTERNAL_SERVICE_TOKEN;
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

    const { userId, limit } = z.object({
      userId: z.string(),
      limit: z.string().optional().transform((val) => val ? parseInt(val, 10) : 50)
    }).parse(query);

    const result = await this.friendService.getFriends(userId, limit || 50);
    
    return {
      friends: result.friends
    };
  }
}
