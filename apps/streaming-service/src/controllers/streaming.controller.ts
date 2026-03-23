import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  BadRequestException,
  Headers,
  HttpException,
  HttpStatus,
  Query
} from "@nestjs/common";
import { RoomService } from "../services/room.service.js";
import { ChatService } from "../services/chat.service.js";
import { DiscoveryClientService } from "../services/discovery-client.service.js";
import { GiftService } from "../services/gift.service.js";
import { HistoryService } from "../services/history.service.js";
import { FavouriteService } from "../services/favourite.service.js";
import { z } from "zod";

// Simple auth guard (you can enhance this later)
const createRoomSchema = z.object({
  userIds: z.array(z.string()).min(2).max(4),
  callType: z.enum(["matched", "squad"]).optional().default("matched")
});

@Controller("streaming")
export class StreamingController {
  constructor(
    private roomService: RoomService,
    private chatService: ChatService,
    private discoveryClient: DiscoveryClientService,
    private giftService: GiftService,
    private historyService: HistoryService,
    private favouriteService: FavouriteService
  ) {}

  /**
   * Create a room (typically called when users enter IN_SQUAD)
   * POST /streaming/rooms
   */
  @Post("rooms")
  async createRoom(@Body() body: unknown) {
    try {
      const { userIds, callType } = createRoomSchema.parse(body);
      return await this.roomService.createRoom(userIds, callType);
    } catch (error: any) {
      // Re-throw BadRequestException to let the filter handle it
      if (error instanceof BadRequestException) {
        throw error;
      }
      // Re-throw other errors
      throw error;
    }
  }

  /**
   * Get room info
   * GET /streaming/rooms/:roomId
   */
  @Get("rooms/:roomId")
  async getRoom(@Param("roomId") roomId: string) {
    const details = await this.roomService.getRoomDetails(roomId);
    if (!details) {
      return { exists: false };
    }
    return { exists: true, ...details };
  }

  /**
   * Get call history (History section)
   * GET /streaming/history?limit=20&cursor=...
   * Requires x-user-id header (set by gateway when auth valid).
   */
  @Get("history")
  async getHistory(
    @Headers("x-user-id") xUserId: string | undefined,
    @Query("limit") limitStr?: string,
    @Query("cursor") cursor?: string
  ) {
    const userId = xUserId?.trim();
    if (!userId) {
      throw new HttpException("Missing x-user-id", HttpStatus.UNAUTHORIZED);
    }
    const limit = Math.min(Math.max(parseInt(limitStr ?? "20", 10) || 20, 1), 100);
    return this.historyService.getCallHistory(userId, limit, cursor || undefined);
  }

  /**
   * Get single call detail (History info icon)
   * GET /streaming/history/:sessionId
   */
  @Get("history/:sessionId")
  async getHistoryCall(
    @Headers("x-user-id") xUserId: string | undefined,
    @Param("sessionId") sessionId: string
  ) {
    const userId = xUserId?.trim();
    if (!userId) {
      throw new HttpException("Missing x-user-id", HttpStatus.UNAUTHORIZED);
    }
    const call = await this.historyService.getCallById(userId, sessionId);
    if (!call) {
      throw new HttpException("Call not found", HttpStatus.NOT_FOUND);
    }
    return call;
  }

  /**
   * Hide call from history (History trash icon)
   * DELETE /streaming/history/:sessionId
   */
  @Delete("history/:sessionId")
  async hideHistoryCall(
    @Headers("x-user-id") xUserId: string | undefined,
    @Param("sessionId") sessionId: string
  ) {
    const userId = xUserId?.trim();
    if (!userId) {
      throw new HttpException("Missing x-user-id", HttpStatus.UNAUTHORIZED);
    }
    await this.historyService.hideFromHistory(userId, sessionId);
    return { ok: true };
  }

  /**
   * Add a participant to favourites (viewer marks favourite while watching).
   * POST /streaming/favourites
   */
  @Post("favourites")
  async addFavourite(
    @Headers("x-user-id") xUserId: string | undefined,
    @Body() body: { targetUserId?: string }
  ) {
    const userId = xUserId?.trim();
    if (!userId) {
      throw new HttpException("Missing x-user-id", HttpStatus.UNAUTHORIZED);
    }
    if (!body?.targetUserId?.trim()) {
      throw new BadRequestException("targetUserId is required");
    }
    await this.favouriteService.addFavourite(userId, body.targetUserId.trim());
    return { success: true };
  }

  /**
   * Remove a participant from favourites.
   * DELETE /streaming/favourites/:targetUserId
   */
  @Delete("favourites/:targetUserId")
  async removeFavourite(
    @Headers("x-user-id") xUserId: string | undefined,
    @Param("targetUserId") targetUserId: string
  ) {
    const userId = xUserId?.trim();
    if (!userId) {
      throw new HttpException("Missing x-user-id", HttpStatus.UNAUTHORIZED);
    }
    await this.favouriteService.removeFavourite(userId, targetUserId);
    return { success: true };
  }

  /**
   * Get favourite users who are currently broadcasting (favourite section).
   * GET /streaming/favourites/broadcasting
   */
  @Get("favourites/broadcasting")
  async getFavouriteBroadcasters(
    @Headers("x-user-id") xUserId: string | undefined,
    @Query("limit") limitStr?: string
  ) {
    const userId = xUserId?.trim();
    if (!userId) {
      throw new HttpException("Missing x-user-id", HttpStatus.UNAUTHORIZED);
    }
    const limit = Math.min(Math.max(parseInt(limitStr ?? "20", 10) || 20, 1), 100);
    return this.favouriteService.getFavouriteBroadcasters(userId, limit);
  }

  /**
   * Get chat history
   * GET /streaming/rooms/:roomId/chat
   */
  @Get("rooms/:roomId/chat")
  async getChatHistory(@Param("roomId") roomId: string) {
    try {
      return await this.chatService.getChatHistory(roomId);
    } catch (error: any) {
      if (error.message?.includes("not found")) {
        throw new BadRequestException(`Room ${roomId} not found`);
      }
      throw error;
    }
  }

  /**
   * Enable pull stranger mode (HOST only)
   * POST /streaming/rooms/:roomId/enable-pull-stranger
   */
  @Post("rooms/:roomId/enable-pull-stranger")
  async enablePullStranger(
    @Param("roomId") roomId: string,
    @Body() body: { userId: string }
  ) {
    if (!body.userId) {
      throw new BadRequestException("userId is required");
    }
    await this.roomService.enablePullStranger(roomId, body.userId);
    return { success: true, message: "Pull stranger mode enabled" };
  }

  /**
   * Join room via pull stranger (one-way acceptance)
   * POST /streaming/rooms/:roomId/join-via-pull-stranger
   */
  @Post("rooms/:roomId/join-via-pull-stranger")
  async joinViaPullStranger(
    @Param("roomId") roomId: string,
    @Body() body: { joiningUserId: string; targetUserId: string }
  ) {
    if (!body.joiningUserId || !body.targetUserId) {
      throw new BadRequestException("joiningUserId and targetUserId are required");
    }
    const result = await this.roomService.joinViaPullStranger(
      roomId,
      body.joiningUserId,
      body.targetUserId
    );
    return {
      success: true,
      roomId: result.roomId,
      sessionId: result.sessionId,
      message: "Successfully joined room via pull stranger"
    };
  }

  /**
   * Get room ID for pull stranger user (for discovery service)
   * GET /streaming/pull-stranger/room/:userId
   */
  @Get("pull-stranger/room/:userId")
  async getRoomForPullStrangerUser(@Param("userId") userId: string) {
    const roomId = await this.roomService.getRoomForPullStrangerUser(userId);
    if (!roomId) {
      return { exists: false };
    }
    return { exists: true, roomId };
  }

  /**
   * Request to join broadcast (viewer clicks "Join" button)
   * POST /streaming/rooms/:roomId/request-to-join
   */
  @Post("rooms/:roomId/request-to-join")
  async requestToJoin(
    @Param("roomId") roomId: string,
    @Body() body: { userId: string }
  ) {
    if (!body.userId) {
      throw new BadRequestException("userId is required");
    }
    await this.roomService.requestToJoin(roomId, body.userId);
    return { success: true, message: "Join request submitted" };
  }

  /**
   * Cancel join request (viewer cancels their request)
   * POST /streaming/rooms/:roomId/cancel-join-request
   */
  @Post("rooms/:roomId/cancel-join-request")
  async cancelJoinRequest(
    @Param("roomId") roomId: string,
    @Body() body: { userId: string }
  ) {
    if (!body.userId) {
      throw new BadRequestException("userId is required");
    }
    await this.roomService.cancelJoinRequest(roomId, body.userId);
    return { success: true, message: "Join request cancelled" };
  }

  /**
   * Get waitlist for a room (hosts can see who requested to join)
   * GET /streaming/rooms/:roomId/waitlist
   */
  @Get("rooms/:roomId/waitlist")
  async getWaitlist(@Param("roomId") roomId: string) {
    const waitlist = await this.roomService.getWaitlist(roomId);
    return { waitlist };
  }

  /**
   * Accept user from waitlist (host adds viewer to call)
   * POST /streaming/rooms/:roomId/accept-from-waitlist
   */
  @Post("rooms/:roomId/accept-from-waitlist")
  async acceptFromWaitlist(
    @Param("roomId") roomId: string,
    @Body() body: { hostUserId: string; targetUserId: string }
  ) {
    if (!body.hostUserId || !body.targetUserId) {
      throw new BadRequestException("hostUserId and targetUserId are required");
    }
    await this.roomService.acceptFromWaitlist(roomId, body.hostUserId, body.targetUserId);
    return { success: true, message: "User added to call from waitlist" };
  }

  /**
   * Get room info for a user
   * GET /streaming/users/:userId/room
   */
  @Get("users/:userId/room")
  async getUserRoom(@Param("userId") userId: string) {
    // Check if user is a participant in any active room
    const participantRoom = await this.roomService.getUserActiveRoom(userId);
    
    if (participantRoom) {
      try {
        const roomDetails = await this.roomService.getRoomDetails(participantRoom.roomId);
        
        if (!roomDetails) {
          return { exists: false };
        }
        
        // Find the user's specific role (HOST or PARTICIPANT)
        const userParticipant = roomDetails.participants.find(p => p.userId === userId);
        const userRole = userParticipant?.role || 'PARTICIPANT';
        
        return {
          exists: true,
          role: 'participant',
          userRole: userRole, // 'HOST' or 'PARTICIPANT'
          ...roomDetails
        };
      } catch (error: any) {
        // Room might have been ended between query and details fetch
        return { exists: false };
      }
    }
    
    // Check if user is a viewer in any active room
    const viewerRoom = await this.roomService.getUserActiveRoomAsViewer(userId);
    if (viewerRoom) {
      try {
        const roomDetails = await this.roomService.getRoomDetails(viewerRoom.roomId);
        
        if (!roomDetails) {
          return { exists: false };
        }
        
        return {
          exists: true,
          role: 'viewer',
          userRole: 'VIEWER',
          ...roomDetails
        };
      } catch (error: any) {
        // Room might have been ended between query and details fetch
        return { exists: false };
      }
    }
    
    return { exists: false };
  }

  /* ---------- Test Endpoints (No Auth Required) ---------- */

  /**
   * Test endpoint: Create a room (bypasses auth)
   * POST /streaming/test/rooms
   */
  @Post("test/rooms")
  async createRoomTest(@Body() body: unknown) {
    try {
      const { userIds, callType } = createRoomSchema.parse(body);
      return await this.roomService.createRoom(userIds, callType);
    } catch (error: any) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw error;
    }
  }

  /**
   * Test endpoint: Get room info (bypasses auth)
   * GET /streaming/test/rooms/:roomId
   */
  @Get("test/rooms/:roomId")
  async getRoomTest(@Param("roomId") roomId: string) {
    const details = await this.roomService.getRoomDetails(roomId);
    if (!details) {
      return { exists: false };
    }
    return { exists: true, ...details };
  }

  /**
   * Test endpoint: Get chat history (bypasses auth)
   * GET /streaming/test/rooms/:roomId/chat
   */
  @Get("test/rooms/:roomId/chat")
  async getChatHistoryTest(@Param("roomId") roomId: string) {
    try {
      return await this.chatService.getChatHistory(roomId);
    } catch (error: any) {
      if (error.message?.includes("not found")) {
        throw new BadRequestException(`Room ${roomId} not found`);
      }
      throw error;
    }
  }

  /**
   * Test endpoint: Get user's room (bypasses auth)
   * GET /streaming/test/users/:userId/room
   */
  @Get("test/users/:userId/room")
  async getUserRoomTest(@Param("userId") userId: string) {
    const participantRoom = await this.roomService.getUserActiveRoom(userId);
    
    if (participantRoom) {
      try {
        const roomDetails = await this.roomService.getRoomDetails(participantRoom.roomId);
        
        if (!roomDetails) {
          return { exists: false };
        }
        
        const userParticipant = roomDetails.participants.find(p => p.userId === userId);
        const userRole = userParticipant?.role || 'PARTICIPANT';
        
        return {
          exists: true,
          role: 'participant',
          userRole: userRole,
          ...roomDetails
        };
      } catch (error: any) {
        return { exists: false };
      }
    }
    
    const viewerRoom = await this.roomService.getUserActiveRoomAsViewer(userId);
    if (viewerRoom) {
      try {
        const roomDetails = await this.roomService.getRoomDetails(viewerRoom.roomId);
        
        if (!roomDetails) {
          return { exists: false };
        }
        
        return {
          exists: true,
          role: 'viewer',
          userRole: 'VIEWER',
          ...roomDetails
        };
      } catch (error: any) {
        return { exists: false };
      }
    }
    
    return { exists: false };
  }

  /**
   * Leave room (authenticated)
   * POST /streaming/rooms/:roomId/leave
   * Uses x-user-id injected by API Gateway after token verification.
   */
  @Post("rooms/:roomId/leave")
  async leaveRoom(
    @Headers("x-user-id") xUserId: string | undefined,
    @Param("roomId") roomId: string,
    @Body() body?: { userId?: string }
  ) {
    const userId = xUserId?.trim() || body?.userId?.trim();
    if (!userId) {
      throw new HttpException("Missing x-user-id", HttpStatus.UNAUTHORIZED);
    }
    await this.roomService.removeParticipant(roomId, userId);
    return { success: true, message: `User ${userId} left room ${roomId}` };
  }

  /**
   * Test endpoint: Leave room (bypasses auth)
   * POST /streaming/test/rooms/:roomId/leave
   */
  @Post("test/rooms/:roomId/leave")
  async leaveRoomTest(
    @Param("roomId") roomId: string,
    @Body() body: { userId: string }
  ) {
    if (!body.userId) {
      throw new BadRequestException("userId is required");
    }
    await this.roomService.removeParticipant(roomId, body.userId);
    return { success: true, message: `User ${body.userId} left room ${roomId}` };
  }

  /**
   * Test endpoint: Kick user from room (bypasses auth)
   * POST /streaming/test/rooms/:roomId/kick
   */
  @Post("test/rooms/:roomId/kick")
  async kickUserTest(
    @Param("roomId") roomId: string,
    @Body() body: { kickerUserId: string; targetUserId: string }
  ) {
    if (!body.kickerUserId || !body.targetUserId) {
      throw new BadRequestException("kickerUserId and targetUserId are required");
    }
    await this.roomService.kickUser(roomId, body.kickerUserId, body.targetUserId);
    return { success: true, message: `User ${body.targetUserId} was kicked by ${body.kickerUserId}` };
  }

  /**
   * Test endpoint: Add participant to room (bypasses auth)
   * POST /streaming/test/rooms/:roomId/add-participant
   */
  @Post("test/rooms/:roomId/add-participant")
  async addParticipantTest(
    @Param("roomId") roomId: string,
    @Body() body: { userId: string }
  ) {
    if (!body.userId) {
      throw new BadRequestException("userId is required");
    }
    await this.roomService.addParticipant(roomId, body.userId);
    return { success: true, message: `User ${body.userId} added to room ${roomId}` };
  }

  /**
   * Test endpoint: End room (bypasses auth)
   * POST /streaming/test/rooms/:roomId/end
   */
  @Post("test/rooms/:roomId/end")
  async endRoomTest(@Param("roomId") roomId: string) {
    await this.roomService.endRoom(roomId);
    return { success: true, message: `Room ${roomId} ended` };
  }

  /**
   * Test endpoint: Enable pull stranger mode (bypasses auth)
   * POST /streaming/test/rooms/:roomId/enable-pull-stranger
   */
  @Post("test/rooms/:roomId/enable-pull-stranger")
  async enablePullStrangerTest(
    @Param("roomId") roomId: string,
    @Body() body: { userId: string }
  ) {
    if (!body.userId) {
      throw new BadRequestException("userId is required");
    }
    await this.roomService.enablePullStranger(roomId, body.userId);
    return { success: true, message: "Pull stranger mode enabled" };
  }

  /**
   * Test endpoint: Join room via pull stranger (bypasses auth)
   * POST /streaming/test/rooms/:roomId/join-via-pull-stranger
   */
  @Post("test/rooms/:roomId/join-via-pull-stranger")
  async joinViaPullStrangerTest(
    @Param("roomId") roomId: string,
    @Body() body: { joiningUserId: string; targetUserId: string }
  ) {
    if (!body.joiningUserId || !body.targetUserId) {
      throw new BadRequestException("joiningUserId and targetUserId are required");
    }
    const result = await this.roomService.joinViaPullStranger(
      roomId,
      body.joiningUserId,
      body.targetUserId
    );
    return {
      success: true,
      roomId: result.roomId,
      sessionId: result.sessionId,
      message: "Successfully joined room via pull stranger"
    };
  }

  /**
   * Test endpoint: Request to join broadcast (bypasses auth)
   * POST /streaming/test/rooms/:roomId/request-to-join
   */
  @Post("test/rooms/:roomId/request-to-join")
  async requestToJoinTest(
    @Param("roomId") roomId: string,
    @Body() body: { userId: string }
  ) {
    if (!body.userId) {
      throw new BadRequestException("userId is required");
    }
    await this.roomService.requestToJoin(roomId, body.userId);
    return { success: true, message: "Join request submitted" };
  }

  /**
   * Test endpoint: Cancel join request (bypasses auth)
   * POST /streaming/test/rooms/:roomId/cancel-join-request
   */
  @Post("test/rooms/:roomId/cancel-join-request")
  async cancelJoinRequestTest(
    @Param("roomId") roomId: string,
    @Body() body: { userId: string }
  ) {
    if (!body.userId) {
      throw new BadRequestException("userId is required");
    }
    await this.roomService.cancelJoinRequest(roomId, body.userId);
    return { success: true, message: "Join request cancelled" };
  }

  /**
   * Test endpoint: Get waitlist (bypasses auth)
   * GET /streaming/test/rooms/:roomId/waitlist
   */
  @Get("test/rooms/:roomId/waitlist")
  async getWaitlistTest(@Param("roomId") roomId: string) {
    const waitlist = await this.roomService.getWaitlist(roomId);
    return { waitlist };
  }

  /**
   * Test endpoint: Accept from waitlist (bypasses auth)
   * POST /streaming/test/rooms/:roomId/accept-from-waitlist
   */
  @Post("test/rooms/:roomId/accept-from-waitlist")
  async acceptFromWaitlistTest(
    @Param("roomId") roomId: string,
    @Body() body: { hostUserId: string; targetUserId: string }
  ) {
    if (!body.hostUserId || !body.targetUserId) {
      throw new BadRequestException("hostUserId and targetUserId are required");
    }
    await this.roomService.acceptFromWaitlist(roomId, body.hostUserId, body.targetUserId);
    return { success: true, message: "User added to call from waitlist" };
  }

  /**
   * Test endpoint: Enable broadcasting (bypasses auth)
   * POST /streaming/test/rooms/:roomId/enable-broadcasting
   */
  @Post("test/rooms/:roomId/enable-broadcasting")
  async enableBroadcastingTest(
    @Param("roomId") roomId: string,
    @Body() body: { userId: string }
  ) {
    if (!body.userId) {
      throw new BadRequestException("userId is required");
    }
    await this.roomService.enableBroadcasting(roomId, body.userId);
    return { success: true, message: "Broadcasting enabled" };
  }

  /**
   * Test endpoint: Add viewer to broadcast (bypasses auth)
   * POST /streaming/test/rooms/:roomId/add-viewer
   */
  @Post("test/rooms/:roomId/add-viewer")
  async addViewerTest(
    @Param("roomId") roomId: string,
    @Body() body: { userId: string }
  ) {
    if (!body.userId) {
      throw new BadRequestException("userId is required");
    }
    await this.roomService.addViewer(roomId, body.userId);
    return { success: true, message: "Viewer added to broadcast" };
  }

  /**
   * POST /streaming/test/rooms/:roomId/remove-viewer
   */
  @Post("test/rooms/:roomId/remove-viewer")
  async removeViewerTest(
    @Param("roomId") roomId: string,
    @Body() body: { userId: string }
  ) {
    if (!body.userId) {
      throw new BadRequestException("userId is required");
    }
    await this.roomService.removeViewer(roomId, body.userId, false);
    return { success: true, message: "Viewer removed from broadcast" };
  }

  /**
   * Test endpoint: Send a gift (bypasses auth)
   * POST /streaming/test/rooms/:roomId/gifts
   */
  @Post("test/rooms/:roomId/gifts")
  async sendGiftTest(
    @Param("roomId") roomId: string,
    @Body() body: { fromUserId: string; toUserId: string; amount: number; giftId: string }
  ) {
    if (!body.fromUserId || !body.toUserId || !body.amount || !body.giftId) {
      throw new BadRequestException("fromUserId, toUserId, amount, and giftId are required");
    }
    return await this.giftService.sendGift(roomId, body.fromUserId, body.toUserId, body.amount, body.giftId);
  }

  /**
   * Test endpoint: Get gifts for a room (bypasses auth)
   * GET /streaming/test/rooms/:roomId/gifts
   */
  @Get("test/rooms/:roomId/gifts")
  async getRoomGiftsTest(@Param("roomId") roomId: string) {
    return await this.giftService.getRoomGifts(roomId);
  }

  /**
   * Report a user (universal API: same shape as POST /v1/users/report)
   * POST /streaming/users/report
   * Forwards to user-service with optional reportType for configurable weight.
   */
  @Post("users/report")
  async reportUser(
    @Body() body: { reportedUserId: string; reportType?: string },
    @Headers("authorization") authz?: string
  ) {
    if (!authz) {
      throw new BadRequestException("Missing authorization header");
    }

    const token = authz.replace("Bearer ", "");
    if (!body.reportedUserId) {
      throw new BadRequestException("reportedUserId is required");
    }
    if (body.reportType !== undefined && typeof body.reportType !== "string") {
      throw new BadRequestException("reportType must be a string if provided");
    }

    const { verifyToken } = await import("@hmm/common");
    const jwkStr = process.env.JWT_PUBLIC_JWK;
    if (!jwkStr || jwkStr === "undefined") {
      throw new BadRequestException("Server configuration error");
    }
    const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
    const publicJwk = JSON.parse(cleanedJwk);
    const verifyAccess = await verifyToken(publicJwk);
    const payload = await verifyAccess(token);
    const reporterUserId = payload.sub;

    if (reporterUserId === body.reportedUserId) {
      throw new BadRequestException("Cannot report yourself");
    }

    const result = await this.discoveryClient.reportUser(
      token,
      body.reportedUserId,
      body.reportType
    );

    return {
      success: true,
      reportCount: result.reportCount
    };
  }

  /**
   * Send gift from OFFLINE cards (without room context)
   * POST /streaming/offline-cards/gifts
   */
  @Post("offline-cards/gifts")
  async sendGiftFromOfflineCard(
    @Body() body: any,
    @Headers("authorization") authz?: string
  ) {
    const sendGiftDirectSchema = z.object({
      toUserId: z.string().min(1, "toUserId is required"),
      amount: z.number().positive("Amount must be positive"),
      giftId: z.string().min(1, "giftId is required"),
      fromUserId: z.string().optional() // Optional in test mode
    });

    const parsed = sendGiftDirectSchema.parse(body);
    const { toUserId, amount, giftId, fromUserId } = parsed;

    // In test mode, allow fromUserId in body, otherwise extract from token
    let finalFromUserId = fromUserId;

    if (!authz && !fromUserId) {
      throw new BadRequestException("Missing authorization header or fromUserId");
    }

    if (authz) {
      // Extract from token
      const token = authz.replace("Bearer ", "");
      const { verifyToken } = await import("@hmm/common");
      const jwkStr = process.env.JWT_PUBLIC_JWK;
      if (!jwkStr || jwkStr === "undefined") {
        throw new BadRequestException("Server configuration error");
      }
      const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
      const publicJwk = JSON.parse(cleanedJwk);
      const verifyAccess = await verifyToken(publicJwk);
      const payload = await verifyAccess(token);
      finalFromUserId = payload.sub;
    } else if (fromUserId) {
      // Test mode: use fromUserId from body
      finalFromUserId = fromUserId;
    }

    if (!finalFromUserId) {
      throw new BadRequestException("fromUserId is required");
    }

    return await this.giftService.sendGiftDirect(finalFromUserId, toUserId, amount, giftId);
  }

  /**
   * Test endpoint: Send gift from OFFLINE cards (bypasses auth)
   * POST /streaming/test/offline-cards/gifts
   */
  @Post("test/offline-cards/gifts")
  async sendGiftFromOfflineCardTest(@Body() body: any) {
    const sendGiftDirectSchema = z.object({
      fromUserId: z.string().min(1, "fromUserId is required"),
      toUserId: z.string().min(1, "toUserId is required"),
      amount: z.number().positive("Amount must be positive"),
      giftId: z.string().min(1, "giftId is required")
    });

    const { fromUserId, toUserId, amount, giftId } = sendGiftDirectSchema.parse(body);
    return await this.giftService.sendGiftDirect(fromUserId, toUserId, amount, giftId);
  }

  /**
   * Get all active broadcasts (for HMM_TV)
   * GET /streaming/broadcasts?sort=recent&limit=20&offset=0&participantCountMin=2&tags[]=fun
   */
  @Get("broadcasts")
  async getActiveBroadcasts(
    @Query("sort") sort?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
    @Query("cursor") cursor?: string,
    @Query("participantCountMin") participantCountMin?: string,
    @Query("participantCountMax") participantCountMax?: string,
    @Query("tags") tags?: string | string[]
  ) {
    // Validate sort parameter
    const validSorts = ['recent', 'viewers', 'popular', 'trending'];
    const validatedSort = sort && validSorts.includes(sort) ? sort as any : 'recent';
    
    // Validate limit (1-100)
    let validatedLimit = 20;
    if (limit) {
      const parsedLimit = parseInt(limit, 10);
      if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
        throw new BadRequestException("limit must be between 1 and 100");
      }
      validatedLimit = parsedLimit;
    }
    
    // Validate offset (non-negative)
    let validatedOffset = 0;
    if (offset) {
      const parsedOffset = parseInt(offset, 10);
      if (isNaN(parsedOffset) || parsedOffset < 0) {
        throw new BadRequestException("offset must be a non-negative integer");
      }
      validatedOffset = parsedOffset;
    }
    
    // Validate participantCountMin/Max (positive integers)
    const filter: any = {};
    if (participantCountMin || participantCountMax) {
      filter.participantCount = {};
      if (participantCountMin) {
        const min = parseInt(participantCountMin, 10);
        if (isNaN(min) || min < 1) {
          throw new BadRequestException("participantCountMin must be a positive integer");
        }
        filter.participantCount.min = min;
      }
      if (participantCountMax) {
        const max = parseInt(participantCountMax, 10);
        if (isNaN(max) || max < 1) {
          throw new BadRequestException("participantCountMax must be a positive integer");
        }
        filter.participantCount.max = max;
      }
      // Validate min <= max
      if (filter.participantCount.min && filter.participantCount.max && 
          filter.participantCount.min > filter.participantCount.max) {
        throw new BadRequestException("participantCountMin must be less than or equal to participantCountMax");
      }
    }
    
    // Validate tags (array of non-empty strings)
    if (tags) {
      const tagsArray = Array.isArray(tags) ? tags : [tags];
      const validatedTags = tagsArray.filter(tag => typeof tag === 'string' && tag.trim().length > 0);
      if (validatedTags.length > 0) {
        filter.tags = validatedTags;
      }
    }

    return await this.roomService.getActiveBroadcasts({
      sort: validatedSort,
      filter,
      limit: validatedLimit,
      offset: validatedOffset,
      cursor: cursor || undefined
    });
  }

  /**
   * Test endpoint: Get all active broadcasts (bypasses auth)
   * GET /streaming/test/broadcasts
   */
  @Get("test/broadcasts")
  async getActiveBroadcastsTest() {
    return await this.roomService.getActiveBroadcasts();
  }
}

