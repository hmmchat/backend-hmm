import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Headers,
  Param,
  HttpException,
  HttpStatus
} from "@nestjs/common";
import { DiscoveryService } from "../services/discovery.service.js";
import { LocationService } from "../services/location.service.js";
import {
  GetCardQuerySchema,
  RaincheckRequestSchema,
  ResetSessionRequestSchema,
  SelectLocationRequestSchema,
  ProceedRequestSchema,
  RoomCreatedRequestSchema,
  BroadcastStartedRequestSchema,
  CallEndedRequestSchema,
  GetOfflineCardQuerySchema,
  OfflineRaincheckRequestSchema
} from "../dtos/discovery.dto.js";

@Controller("discovery")
export class DiscoveryController {
  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly locationService: LocationService
  ) {}

  private getTokenFromHeader(h?: string) {
    if (!h) return null;
    const [t, v] = h.split(" ");
    return t?.toLowerCase() === "bearer" ? v : null;
  }

  /**
   * Get next face card
   * GET /discovery/card?sessionId=xxx&soloOnly=false
   */
  @Get("card")
  async getCard(
    @Headers("authorization") authz?: string,
    @Query() query?: any
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const dto = GetCardQuerySchema.parse(query || {});
    const soloOnly = dto.soloOnly || false;

    return this.discoveryService.getNextCard(token, dto.sessionId, soloOnly);
  }

  /**
   * Mark current card as rainchecked
   * POST /discovery/raincheck
   */
  @Post("raincheck")
  async raincheck(
    @Headers("authorization") authz: string,
    @Body() body: any
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const dto = RaincheckRequestSchema.parse(body);

    // Get user ID from token
    const { verifyToken } = await import("@hmm/common");
    const jwkStr = process.env.JWT_PUBLIC_JWK;
    if (!jwkStr || jwkStr === "undefined") {
      throw new HttpException("Server configuration error", HttpStatus.INTERNAL_SERVER_ERROR);
    }
    const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
    const publicJwk = JSON.parse(cleanedJwk);
    const verifyAccess = await verifyToken(publicJwk);
    const payload = await verifyAccess(token);
    const userId = payload.sub;

    // Get user's preferred city
    const cityResponse = await this.locationService.getPreferredCity(token);
    const city = cityResponse.city;

    // Mark as rainchecked
    await this.discoveryService.markRaincheck(
      userId,
      dto.sessionId,
      dto.raincheckedUserId,
      city
    );

    // Return next card
    const soloOnly = false; // Could be passed in request if needed
    const nextCard = await this.discoveryService.getNextCard(
      token,
      dto.sessionId,
      soloOnly
    );

    return {
      success: true,
      nextCard: nextCard.card
    };
  }

  /**
   * Proceed with matched user (both users proceed to IN_SQUAD)
   * POST /discovery/proceed
   */
  @Post("proceed")
  async proceed(
    @Headers("authorization") authz: string,
    @Body() body: any
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const dto = ProceedRequestSchema.parse(body);

    // Get user ID from token
    const { verifyToken } = await import("@hmm/common");
    const jwkStr = process.env.JWT_PUBLIC_JWK;
    if (!jwkStr || jwkStr === "undefined") {
      throw new HttpException("Server configuration error", HttpStatus.INTERNAL_SERVER_ERROR);
    }
    const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
    const publicJwk = JSON.parse(cleanedJwk);
    const verifyAccess = await verifyToken(publicJwk);
    const payload = await verifyAccess(token);
    const userId = payload.sub;

    // Proceed with match
    await this.discoveryService.proceedWithMatch(userId, dto.matchedUserId);

    return {
      success: true
    };
  }

  /**
   * Get suggested cities when exhausted
   * GET /discovery/fallback-cities?limit=10
   */
  @Get("fallback-cities")
  async getFallbackCities(@Query("limit") limit?: string) {
    const limitNum = limit ? parseInt(limit, 10) : 10;
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 50) {
      throw new HttpException("Limit must be between 1 and 50", HttpStatus.BAD_REQUEST);
    }

    const cities = await this.discoveryService.getFallbackCities(limitNum);
    return { cities };
  }

  /**
   * Reset session (clear rainchecked users for a city)
   * POST /discovery/reset-session
   */
  @Post("reset-session")
  async resetSession(
    @Headers("authorization") authz: string,
    @Body() body: any
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const dto = ResetSessionRequestSchema.parse(body);

    // Get user ID from token
    const { verifyToken } = await import("@hmm/common");
    const jwkStr = process.env.JWT_PUBLIC_JWK;
    if (!jwkStr || jwkStr === "undefined") {
      throw new HttpException("Server configuration error", HttpStatus.INTERNAL_SERVER_ERROR);
    }
    const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
    const publicJwk = JSON.parse(cleanedJwk);
    const verifyAccess = await verifyToken(publicJwk);
    const payload = await verifyAccess(token);
    const userId = payload.sub;

    // Get user's preferred city
    const cityResponse = await this.locationService.getPreferredCity(token);
    const city = cityResponse.city;

    // Reset session
    await this.discoveryService.resetSession(userId, dto.sessionId, city);

    return { success: true };
  }

  /**
   * Select a location card (user chose a city from location cards)
   * POST /discovery/select-location
   */
  @Post("select-location")
  async selectLocation(
    @Headers("authorization") authz: string,
    @Body() body: any
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const dto = SelectLocationRequestSchema.parse(body);

    // Get user ID from token
    const { verifyToken } = await import("@hmm/common");
    const jwkStr = process.env.JWT_PUBLIC_JWK;
    if (!jwkStr || jwkStr === "undefined") {
      throw new HttpException("Server configuration error", HttpStatus.INTERNAL_SERVER_ERROR);
    }
    const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
    const publicJwk = JSON.parse(cleanedJwk);
    const verifyAccess = await verifyToken(publicJwk);
    const payload = await verifyAccess(token);
    const userId = payload.sub;

    // Update user's preferred city
    await this.locationService.updatePreferredCity(token, dto.city);

    // Reset session for the new city (clears both user rainchecks and location cards)
    await this.discoveryService.resetSession(userId, dto.sessionId, dto.city);
    
    // Also clear location cards for this session
    await this.discoveryService.clearLocationCards(userId, dto.sessionId);

    // Return next user card for the selected location
    const soloOnly = false;
    const nextCard = await this.discoveryService.getNextCard(
      token,
      dto.sessionId,
      soloOnly
    );

    return {
      success: true,
      nextCard: nextCard.card,
      isLocationCard: false
    };
  }

  /* ---------- Test Endpoints (No Auth Required) ---------- */

  /**
   * Test endpoint: Get next face card (bypasses auth)
   * GET /discovery/test/card?userId=xxx&sessionId=xxx&soloOnly=false
   */
  @Get("test/card")
  async getCardTest(
    @Query("userId") userId: string,
    @Query("sessionId") sessionId: string,
    @Query("soloOnly") soloOnly?: string
  ) {
    if (!userId || !sessionId) {
      throw new HttpException("userId and sessionId are required", HttpStatus.BAD_REQUEST);
    }

    const soloOnlyBool = soloOnly === "true" || soloOnly === "1";
    return this.discoveryService.getNextCardForUser(userId, sessionId, soloOnlyBool);
  }

  /**
   * Test endpoint: Raincheck (bypasses auth)
   * POST /discovery/test/raincheck
   */
  @Post("test/raincheck")
  async raincheckTest(@Body() body: any) {
    const { userId, sessionId, raincheckedUserId } = body;

    if (!userId || !sessionId || !raincheckedUserId) {
      throw new HttpException("userId, sessionId, and raincheckedUserId are required", HttpStatus.BAD_REQUEST);
    }

    // Get user's preferred city directly from user service
    const cityResponse = await this.locationService.getPreferredCityForUser(userId);
    const city = cityResponse.city;

    // Mark as rainchecked
    await this.discoveryService.markRaincheck(userId, sessionId, raincheckedUserId, city);

    // Return next card
    const nextCard = await this.discoveryService.getNextCardForUser(userId, sessionId, false);

    return {
      success: true,
      nextCard: nextCard.card
    };
  }

  /**
   * Test endpoint: Reset session (bypasses auth)
   * POST /discovery/test/reset-session
   */
  @Post("test/reset-session")
  async resetSessionTest(@Body() body: any) {
    const { userId, sessionId } = body;

    if (!userId || !sessionId) {
      throw new HttpException("userId and sessionId are required", HttpStatus.BAD_REQUEST);
    }

    // Reset session for ALL cities (pass null to clear all rainchecked users)
    await this.discoveryService.resetSession(userId, sessionId, null);
    
    // Also clear location cards
    await this.discoveryService.clearLocationCards(userId, sessionId);

    return { success: true };
  }

  /**
   * Test endpoint: Select location (bypasses auth)
   * POST /discovery/test/select-location
   */
  @Post("test/select-location")
  async selectLocationTest(@Body() body: any) {
    const { userId, sessionId, city } = body;

    if (!userId || !sessionId) {
      throw new HttpException("userId and sessionId are required", HttpStatus.BAD_REQUEST);
    }

    // Update user's preferred city
    await this.locationService.updatePreferredCityForUser(userId, city);

    // Reset session for the new city (clears both user rainchecks and location cards)
    await this.discoveryService.resetSession(userId, sessionId, city);
    
    // Also clear location cards for this session
    await this.discoveryService.clearLocationCards(userId, sessionId);

    // Return next user card for the selected location
    const nextCard = await this.discoveryService.getNextCardForUser(userId, sessionId, false);

    return {
      success: true,
      nextCard: nextCard.card,
      isLocationCard: false
    };
  }

  /**
   * Test endpoint: Proceed (bypasses auth)
   * POST /discovery/test/proceed
   */
  @Post("test/proceed")
  async proceedTest(@Body() body: any) {
    const { userId, matchedUserId, timeoutSeconds } = body;

    if (!userId || !matchedUserId) {
      throw new HttpException("userId and matchedUserId are required", HttpStatus.BAD_REQUEST);
    }

    // Proceed with match (returns room info if both users accepted)
    // timeoutSeconds is optional - defaults to 30 seconds for testing (or env var)
    const result = await this.discoveryService.proceedWithMatch(
      userId, 
      matchedUserId,
      timeoutSeconds ? parseInt(timeoutSeconds, 10) : undefined
    );

    return {
      success: true,
      ...result
    };
  }

  /* ---------- Internal Service Endpoints (Service-to-Service) ---------- */

  /**
   * Internal endpoint: Notify that room was created (users enter IN_SQUAD)
   * POST /discovery/internal/room-created
   * Called by streaming-service when a room is created
   */
  @Post("internal/room-created")
  async roomCreated(@Body() body: any) {
    const dto = RoomCreatedRequestSchema.parse(body);
    await this.discoveryService.handleRoomCreated(dto.roomId, dto.userIds);

    return {
      success: true,
      message: `Updated ${dto.userIds.length} users to IN_SQUAD for room ${dto.roomId}`
    };
  }

  /**
   * Internal endpoint: Notify that broadcast started (users enter IN_BROADCAST)
   * POST /discovery/internal/broadcast-started
   * Called by streaming-service when broadcasting starts
   */
  @Post("internal/broadcast-started")
  async broadcastStarted(@Body() body: any) {
    const dto = BroadcastStartedRequestSchema.parse(body);
    await this.discoveryService.handleBroadcastStarted(dto.roomId, dto.userIds);

    return {
      success: true,
      message: `Updated ${dto.userIds.length} users to IN_BROADCAST for room ${dto.roomId}`
    };
  }

  /**
   * Internal endpoint: Notify that call ended (users return to AVAILABLE)
   * POST /discovery/internal/call-ended
   * Called by streaming-service when a call ends
   */
  @Post("internal/call-ended")
  async callEnded(@Body() body: any) {
    const dto = CallEndedRequestSchema.parse(body);
    await this.discoveryService.handleCallEnded(dto.roomId, dto.userIds);

    return {
      success: true,
      message: `Updated ${dto.userIds.length} users to AVAILABLE after call ended in room ${dto.roomId}`
    };
  }

  /* ---------- OFFLINE Cards Endpoints ---------- */

  /**
   * Get next OFFLINE card (users with ONLINE/OFFLINE/VIEWER status)
   * GET /discovery/offline-cards/card?sessionId=xxx&soloOnly=false
   */
  @Get("offline-cards/card")
  async getOfflineCard(
    @Headers("authorization") authz?: string,
    @Query() query?: any
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const dto = GetOfflineCardQuerySchema.parse(query || {});
    const soloOnly = dto.soloOnly || false;

    return this.discoveryService.getNextOfflineCard(token, dto.sessionId, soloOnly);
  }

  /**
   * Mark current OFFLINE card as rainchecked
   * POST /discovery/offline-cards/raincheck
   */
  @Post("offline-cards/raincheck")
  async offlineRaincheck(
    @Headers("authorization") authz: string,
    @Body() body: any
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const dto = OfflineRaincheckRequestSchema.parse(body);

    // Get user ID from token
    const { verifyToken } = await import("@hmm/common");
    const jwkStr = process.env.JWT_PUBLIC_JWK;
    if (!jwkStr || jwkStr === "undefined") {
      throw new HttpException("Server configuration error", HttpStatus.INTERNAL_SERVER_ERROR);
    }
    const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
    const publicJwk = JSON.parse(cleanedJwk);
    const verifyAccess = await verifyToken(publicJwk);
    const payload = await verifyAccess(token);
    const userId = payload.sub;

    // Get user's preferred city
    const cityResponse = await this.locationService.getPreferredCity(token);
    const city = cityResponse.city;

    // Mark as rainchecked (uses prefixed sessionId to avoid conflicts)
    await this.discoveryService.markOfflineRaincheck(
      userId,
      dto.sessionId,
      dto.raincheckedUserId,
      city
    );

    // Return next card
    const soloOnly = false;
    const nextCard = await this.discoveryService.getNextOfflineCard(
      token,
      dto.sessionId,
      soloOnly
    );

    return {
      success: true,
      nextCard: nextCard.card
    };
  }

  /* ---------- Test Endpoints for OFFLINE Cards (No Auth Required) ---------- */

  /**
   * Test endpoint: Get next OFFLINE card (bypasses auth)
   * GET /discovery/test/offline-cards/card?userId=xxx&sessionId=xxx&soloOnly=false
   */
  @Get("test/offline-cards/card")
  async getOfflineCardTest(
    @Query("userId") userId: string,
    @Query("sessionId") sessionId: string,
    @Query("soloOnly") soloOnly?: string
  ) {
    if (!userId || !sessionId) {
      throw new HttpException("userId and sessionId are required", HttpStatus.BAD_REQUEST);
    }

    const soloOnlyBool = soloOnly === "true" || soloOnly === "1";
    return this.discoveryService.getNextOfflineCardForUser(userId, sessionId, soloOnlyBool);
  }

  /**
   * Test endpoint: OFFLINE Raincheck (bypasses auth)
   * POST /discovery/test/offline-cards/raincheck
   */
  @Post("test/offline-cards/raincheck")
  async offlineRaincheckTest(@Body() body: any) {
    const { userId, sessionId, raincheckedUserId } = body;

    if (!userId || !sessionId || !raincheckedUserId) {
      throw new HttpException("userId, sessionId, and raincheckedUserId are required", HttpStatus.BAD_REQUEST);
    }

    // Get user's preferred city directly from user service
    const cityResponse = await this.locationService.getPreferredCityForUser(userId);
    const city = cityResponse.city;

    // Mark as rainchecked (uses prefixed sessionId)
    await this.discoveryService.markOfflineRaincheck(userId, sessionId, raincheckedUserId, city);

    // Return next card
    const nextCard = await this.discoveryService.getNextOfflineCardForUser(userId, sessionId, false);

    return {
      success: true,
      nextCard: nextCard.card
    };
  }

  /* ---------- HMM_TV Broadcast Feed Endpoints ---------- */

  /**
   * Get next broadcast in HMM_TV feed (for scrolling like TikTok/Reels)
   * GET /discovery/broadcasts/feed?sessionId=xxx&deviceId=xxx
   * Auth is optional - works for anonymous users using deviceId
   */
  @Get("broadcasts/feed")
  async getNextBroadcast(
    @Headers("authorization") authz?: string,
    @Query() query?: any
  ) {
    const token = this.getTokenFromHeader(authz);
    const sessionId = query?.sessionId;
    const deviceId = query?.deviceId;

    if (!sessionId) {
      throw new HttpException("sessionId is required", HttpStatus.BAD_REQUEST);
    }

    // If authenticated, use token; otherwise use deviceId for anonymous access
    if (token) {
      return this.discoveryService.getNextBroadcast(token, sessionId);
    } else {
      if (!deviceId) {
        throw new HttpException("deviceId is required for anonymous access", HttpStatus.BAD_REQUEST);
      }
      return this.discoveryService.getNextBroadcastAnonymous(sessionId, deviceId);
    }
  }

  /**
   * Mark broadcast as viewed (swipe to next)
   * POST /discovery/broadcasts/viewed
   * Auth is optional - works for anonymous users using deviceId
   */
  @Post("broadcasts/viewed")
  async markBroadcastViewed(
    @Headers("authorization") authz?: string,
    @Body() body?: any
  ) {
    const token = this.getTokenFromHeader(authz);
    const { sessionId, roomId, deviceId, duration } = body || {};

    if (!sessionId || !roomId) {
      throw new HttpException("sessionId and roomId are required", HttpStatus.BAD_REQUEST);
    }

    // If authenticated, use token; otherwise use deviceId for anonymous access
    if (token) {
      const { verifyToken } = await import("@hmm/common");
      const jwkStr = process.env.JWT_PUBLIC_JWK;
      if (!jwkStr || jwkStr === "undefined") {
        throw new HttpException("Server configuration error", HttpStatus.INTERNAL_SERVER_ERROR);
      }
      const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
      const publicJwk = JSON.parse(cleanedJwk);
      const verifyAccess = await verifyToken(publicJwk);
      const payload = await verifyAccess(token);
      const userId = payload.sub;

      await this.discoveryService.markBroadcastViewed(userId, sessionId, roomId, duration);
    } else {
      if (!deviceId) {
        throw new HttpException("deviceId is required for anonymous access", HttpStatus.BAD_REQUEST);
      }
      await this.discoveryService.markBroadcastViewedAnonymous(sessionId, roomId, deviceId, duration);
    }

    return {
      success: true
    };
  }

  /* ---------- Test Endpoints for HMM_TV Broadcasts (No Auth Required) ---------- */

  /**
   * Test endpoint: Get next broadcast in feed (bypasses auth)
   * GET /discovery/test/broadcasts/feed?userId=xxx&sessionId=xxx
   */
  @Get("test/broadcasts/feed")
  async getNextBroadcastTest(
    @Query("userId") userId: string,
    @Query("sessionId") sessionId: string
  ) {
    if (!userId || !sessionId) {
      throw new HttpException("userId and sessionId are required", HttpStatus.BAD_REQUEST);
    }

    return this.discoveryService.getNextBroadcastForUser(userId, sessionId);
  }

  /**
   * Test endpoint: Mark broadcast as viewed (bypasses auth)
   * POST /discovery/test/broadcasts/viewed
   */
  @Post("test/broadcasts/viewed")
  async markBroadcastViewedTest(@Body() body: any) {
    const { userId, sessionId, roomId } = body;

    if (!userId || !sessionId || !roomId) {
      throw new HttpException("userId, sessionId, and roomId are required", HttpStatus.BAD_REQUEST);
    }

    await this.discoveryService.markBroadcastViewed(userId, sessionId, roomId);

    return {
      success: true
    };
  }

  /* ---------- Broadcast Engagement Endpoints ---------- */

  /**
   * Add a comment to a broadcast
   * POST /discovery/broadcasts/:roomId/comment
   */
  @Post("broadcasts/:roomId/comment")
  async commentBroadcast(
    @Headers("authorization") authz: string,
    @Param("roomId") roomId: string,
    @Body() body: { comment: string }
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    if (!body.comment || typeof body.comment !== 'string' || body.comment.trim().length === 0) {
      throw new HttpException("comment is required and cannot be empty", HttpStatus.BAD_REQUEST);
    }

    if (body.comment.length > 500) {
      throw new HttpException("comment must be 500 characters or less", HttpStatus.BAD_REQUEST);
    }

    const { verifyToken } = await import("@hmm/common");
    const jwkStr = process.env.JWT_PUBLIC_JWK;
    if (!jwkStr || jwkStr === "undefined") {
      throw new HttpException("Server configuration error", HttpStatus.INTERNAL_SERVER_ERROR);
    }
    const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
    const publicJwk = JSON.parse(cleanedJwk);
    const verifyAccess = await verifyToken(publicJwk);
    const payload = await verifyAccess(token);
    const userId = payload.sub;

    const result = await this.discoveryService.addBroadcastComment(roomId, userId, body.comment);
    return result;
  }

  /**
   * Get comments for a broadcast
   * GET /discovery/broadcasts/:roomId/comments?limit=50&offset=0
   */
  @Get("broadcasts/:roomId/comments")
  async getBroadcastComments(
    @Param("roomId") roomId: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string
  ) {
    const validatedLimit = limit ? Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100) : 50;
    const validatedOffset = offset ? Math.max(parseInt(offset, 10) || 0, 0) : 0;

    const result = await this.discoveryService.getBroadcastComments(roomId, validatedLimit, validatedOffset);
    return result;
  }

  /**
   * Get broadcast details by roomId (for deep linking)
   * GET /discovery/broadcasts/:roomId
   * Public endpoint - no authentication required for deep linking
   */
  @Get("broadcasts/:roomId")
  async getBroadcastByRoomId(
    @Param("roomId") roomId: string
  ) {
    const result = await this.discoveryService.getBroadcastByRoomId(roomId);
    if (!result) {
      throw new HttpException("Broadcast not found or not active", HttpStatus.NOT_FOUND);
    }
    return result;
  }

  /**
   * Share a broadcast
   * POST /discovery/broadcasts/:roomId/share
   * Auth is optional - anonymous users can share too
   */
  @Post("broadcasts/:roomId/share")
  async shareBroadcast(
    @Headers("authorization") authz?: string,
    @Param("roomId") roomId: string,
    @Body() body?: { shareType?: string; deviceId?: string }
  ) {
    const token = this.getTokenFromHeader(authz);
    const shareType = body?.shareType || "link";

    // If authenticated, use userId; otherwise use deviceId for anonymous
    if (token) {
      const { verifyToken } = await import("@hmm/common");
      const jwkStr = process.env.JWT_PUBLIC_JWK;
      if (!jwkStr || jwkStr === "undefined") {
        throw new HttpException("Server configuration error", HttpStatus.INTERNAL_SERVER_ERROR);
      }
      const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
      const publicJwk = JSON.parse(cleanedJwk);
      const verifyAccess = await verifyToken(publicJwk);
      const payload = await verifyAccess(token);
      const userId = payload.sub;

      const result = await this.discoveryService.shareBroadcast(roomId, userId, shareType);
      return result;
    } else {
      // Anonymous share - just track the share event without userId
      const deviceId = body?.deviceId;
      const result = await this.discoveryService.shareBroadcastAnonymous(roomId, shareType, deviceId);
      return result;
    }
  }

  /**
   * Send gift to broadcast participants
   * POST /discovery/broadcasts/:roomId/gift
   */
  @Post("broadcasts/:roomId/gift")
  async sendBroadcastGift(
    @Headers("authorization") authz: string,
    @Param("roomId") roomId: string,
    @Body() body: { toUserId: string; amount: number; giftId: string }
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    if (!body.toUserId || !body.amount || !body.giftId) {
      throw new HttpException("toUserId, amount, and giftId are required", HttpStatus.BAD_REQUEST);
    }

    if (body.amount <= 0) {
      throw new HttpException("amount must be positive", HttpStatus.BAD_REQUEST);
    }

    const { verifyToken } = await import("@hmm/common");
    const jwkStr = process.env.JWT_PUBLIC_JWK;
    if (!jwkStr || jwkStr === "undefined") {
      throw new HttpException("Server configuration error", HttpStatus.INTERNAL_SERVER_ERROR);
    }
    const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
    const publicJwk = JSON.parse(cleanedJwk);
    const verifyAccess = await verifyToken(publicJwk);
    const payload = await verifyAccess(token);
    const fromUserId = payload.sub;

    const result = await this.discoveryService.sendBroadcastGift(roomId, fromUserId, body.toUserId, body.amount, body.giftId);
    return result;
  }

  /**
   * Follow a broadcast participant
   * POST /discovery/broadcasts/:roomId/follow/:userId
   * A viewer can follow individual participants in a broadcast
   */
  @Post("broadcasts/:roomId/follow/:userId")
  async followBroadcastParticipant(
    @Headers("authorization") authz: string,
    @Param("roomId") roomId: string,
    @Param("userId") followedUserId: string
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const { verifyToken } = await import("@hmm/common");
    const jwkStr = process.env.JWT_PUBLIC_JWK;
    if (!jwkStr || jwkStr === "undefined") {
      throw new HttpException("Server configuration error", HttpStatus.INTERNAL_SERVER_ERROR);
    }
    const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
    const publicJwk = JSON.parse(cleanedJwk);
    const verifyAccess = await verifyToken(publicJwk);
    const payload = await verifyAccess(token);
    const followerId = payload.sub;

    const result = await this.discoveryService.followBroadcastParticipant(
      followerId,
      followedUserId,
      roomId
    );
    return result;
  }

  /**
   * Unfollow a broadcast participant
   * POST /discovery/broadcasts/:roomId/unfollow/:userId
   */
  @Post("broadcasts/:roomId/unfollow/:userId")
  async unfollowBroadcastParticipant(
    @Headers("authorization") authz: string,
    @Param("roomId") roomId: string,
    @Param("userId") followedUserId: string
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const { verifyToken } = await import("@hmm/common");
    const jwkStr = process.env.JWT_PUBLIC_JWK;
    if (!jwkStr || jwkStr === "undefined") {
      throw new HttpException("Server configuration error", HttpStatus.INTERNAL_SERVER_ERROR);
    }
    const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
    const publicJwk = JSON.parse(cleanedJwk);
    const verifyAccess = await verifyToken(publicJwk);
    const payload = await verifyAccess(token);
    const followerId = payload.sub;

    const result = await this.discoveryService.unfollowBroadcastParticipant(
      followerId,
      followedUserId,
      roomId
    );
    return result;
  }

  /**
   * Get all users followed by the viewer in broadcasts
   * GET /discovery/broadcasts/follows
   * This can be used later for the "sent request section"
   */
  @Get("broadcasts/follows")
  async getFollowedBroadcastParticipants(
    @Headers("authorization") authz: string
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const { verifyToken } = await import("@hmm/common");
    const jwkStr = process.env.JWT_PUBLIC_JWK;
    if (!jwkStr || jwkStr === "undefined") {
      throw new HttpException("Server configuration error", HttpStatus.INTERNAL_SERVER_ERROR);
    }
    const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
    const publicJwk = JSON.parse(cleanedJwk);
    const verifyAccess = await verifyToken(publicJwk);
    const payload = await verifyAccess(token);
    const followerId = payload.sub;

    const result = await this.discoveryService.getFollowedBroadcastParticipants(followerId);
    return { follows: result };
  }

  /**
   * Check if viewer is following a participant in a broadcast
   * GET /discovery/broadcasts/:roomId/follow/:userId/status
   */
  @Get("broadcasts/:roomId/follow/:userId/status")
  async checkFollowStatus(
    @Headers("authorization") authz: string,
    @Param("roomId") roomId: string,
    @Param("userId") followedUserId: string
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const { verifyToken } = await import("@hmm/common");
    const jwkStr = process.env.JWT_PUBLIC_JWK;
    if (!jwkStr || jwkStr === "undefined") {
      throw new HttpException("Server configuration error", HttpStatus.INTERNAL_SERVER_ERROR);
    }
    const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
    const publicJwk = JSON.parse(cleanedJwk);
    const verifyAccess = await verifyToken(publicJwk);
    const payload = await verifyAccess(token);
    const followerId = payload.sub;

    const isFollowing = await this.discoveryService.isFollowingBroadcastParticipant(
      followerId,
      followedUserId,
      roomId
    );
    return { isFollowing };
  }
}

