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
  SelectLocationRequestSchema
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

    // Get user's preferred city directly from user service
    const cityResponse = await this.locationService.getPreferredCityForUser(userId);
    const city = cityResponse.city;

    // Reset session
    await this.discoveryService.resetSession(userId, sessionId, city);

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
}

