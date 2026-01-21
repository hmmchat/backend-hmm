import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Headers,
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
}

