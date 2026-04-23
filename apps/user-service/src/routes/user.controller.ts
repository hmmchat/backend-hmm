import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Headers,
  HttpException,
  HttpStatus,
  Query
} from "@nestjs/common";
import { z } from "zod";
import { UserService } from "../services/user.service.js";
import { MusicService } from "../services/music.service.js";
import {
  CreateProfileSchema,
  UpdateProfileSchema,
  CreatePhotoSchema,
  UpdateBrandPreferencesSchema,
  UpdateInterestsSchema,
  UpdateValuesSchema,
  UpdateLocationSchema,
  UpdatePreferredCitySchema,
  UpdateStatusSchema,
  UpdateIntentSchema,
  CreateMusicPreferenceSchema
} from "../dtos/profile.dto.js";
import { UpdateZodiacSchema } from "../dtos/zodiac.dto.js";
import { UserStatus } from "../../node_modules/.prisma/client/index.js";
import {
  NEARBY_DEFAULT_RADIUS_KM,
  NEARBY_DEFAULT_LIMIT,
  CITIES_MAX_USERS_DEFAULT_LIMIT,
  DISCOVERY_USERS_DEFAULT_LIMIT,
  SEARCH_DEFAULT_LIMIT
} from "../config/limits.config.js";

@Controller()
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly musicService: MusicService
  ) {}

  private getTokenFromHeader(h?: string) {
    if (!h) return null;
    const [t, v] = h.split(" ");
    return t?.toLowerCase() === "bearer" ? v : null;
  }

  /** Returns `sub` when a valid Bearer token is sent; otherwise null (no auth header or not Bearer). */
  private async verifyOptionalUserId(authz?: string): Promise<string | null> {
    const token = this.getTokenFromHeader(authz);
    if (!token) return null;

    const { verifyToken } = await import("@hmm/common");
    const jwkStr = process.env.JWT_PUBLIC_JWK;
    if (!jwkStr || jwkStr === "undefined") {
      throw new HttpException("Server configuration error", HttpStatus.INTERNAL_SERVER_ERROR);
    }
    const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
    const publicJwk = JSON.parse(cleanedJwk);
    const verifyAccess = await verifyToken(publicJwk);
    const payload = await verifyAccess(token);
    return payload.sub;
  }

  /* ---------- Profile Management ---------- */

  @Post("users/:userId/profile")
  async createProfile(@Param("userId") userId: string, @Body() body: any) {
    const dto = CreateProfileSchema.parse(body);
    return this.userService.createProfile(userId, dto);
  }

  @Get("users/:userId")
  async getProfile(@Param("userId") userId: string, @Query("fields") fields?: string) {
    const fieldArray = fields ? fields.split(",").map(f => f.trim()).filter(Boolean) : undefined;
    return this.userService.getProfile(userId, fieldArray);
  }

  @Get("me")
  async getMyProfile(@Headers("authorization") authz?: string, @Query("fields") fields?: string) {
    const token = this.getTokenFromHeader(authz);
    if (!token) throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);

    // Verify token and get userId
    const { verifyToken } = await import("@hmm/common");
    const jwkStr = process.env.JWT_PUBLIC_JWK;
    if (!jwkStr || jwkStr === "undefined") {
      throw new HttpException("Server configuration error", HttpStatus.INTERNAL_SERVER_ERROR);
    }
    const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
    const publicJwk = JSON.parse(cleanedJwk);
    const verifyAccess = await verifyToken(publicJwk);
    const payload = await verifyAccess(token);

    const fieldArray = fields ? fields.split(",").map(f => f.trim()).filter(Boolean) : undefined;
    return this.userService.getProfile(payload.sub, fieldArray);
  }

  @Get("me/profile-completion")
  async getMyProfileCompletion(@Headers("authorization") authz?: string) {
    const token = this.getTokenFromHeader(authz);
    if (!token) throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);

    // Verify token and get userId
    const { verifyToken } = await import("@hmm/common");
    const jwkStr = process.env.JWT_PUBLIC_JWK;
    if (!jwkStr || jwkStr === "undefined") {
      throw new HttpException("Server configuration error", HttpStatus.INTERNAL_SERVER_ERROR);
    }
    const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
    const publicJwk = JSON.parse(cleanedJwk);
    const verifyAccess = await verifyToken(publicJwk);
    const payload = await verifyAccess(token);

    return this.userService.getProfileCompletion(payload.sub);
  }

  @Patch("me/profile")
  async updateProfile(@Headers("authorization") authz: string, @Body() body: any) {
    const token = this.getTokenFromHeader(authz);
    if (!token) throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    const dto = UpdateProfileSchema.parse(body);
    return this.userService.updateProfile(token, dto);
  }

  /* ---------- Photo Management ---------- */

  @Get("me/photos")
  async getMyPhotos(@Headers("authorization") authz?: string) {
    const token = this.getTokenFromHeader(authz);
    if (!token) throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);

    const { verifyToken } = await import("@hmm/common");
    const jwkStr = process.env.JWT_PUBLIC_JWK;
    if (!jwkStr || jwkStr === "undefined") {
      throw new HttpException("Server configuration error", HttpStatus.INTERNAL_SERVER_ERROR);
    }
    const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
    const publicJwk = JSON.parse(cleanedJwk);
    const verifyAccess = await verifyToken(publicJwk);
    const payload = await verifyAccess(token);

    return this.userService.getPhotos(payload.sub);
  }

  @Get("users/:userId/photos")
  async getPhotos(@Param("userId") userId: string) {
    return this.userService.getPhotos(userId);
  }

  @Post("me/photos")
  async addPhoto(@Headers("authorization") authz: string, @Body() body: any) {
    const token = this.getTokenFromHeader(authz);
    if (!token) throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    const dto = CreatePhotoSchema.parse(body);
    return this.userService.addPhoto(token, dto);
  }

  @Delete("me/photos/:photoId")
  async deletePhoto(@Headers("authorization") authz: string, @Param("photoId") photoId: string) {
    const token = this.getTokenFromHeader(authz);
    if (!token) throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    return this.userService.deletePhoto(token, photoId);
  }

  /* ---------- Catalog Data (Public Endpoints) ---------- */

  @Get("brands")
  async getBrands(@Query("limit") limit?: string, @Headers("authorization") authz?: string) {
    const limitNum = limit !== undefined && limit !== "" ? parseInt(limit, 10) : 8;
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 50) {
      throw new HttpException("Limit must be between 1 and 50", HttpStatus.BAD_REQUEST);
    }
    const userId = await this.verifyOptionalUserId(authz);
    return this.userService.getBrands(limitNum, userId);
  }

  @Get("brands/search")
  async searchBrands(
    @Query("q") query?: string,
    @Query("limit") limit?: string,
    @Headers("authorization") authz?: string
  ) {
    if (!query || query.trim().length === 0) {
      throw new HttpException("Search query (q) is required", HttpStatus.BAD_REQUEST);
    }
    const limitNum = limit !== undefined && limit !== "" ? parseInt(limit, 10) : SEARCH_DEFAULT_LIMIT;
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 50) {
      throw new HttpException("Limit must be between 1 and 50", HttpStatus.BAD_REQUEST);
    }
    const userId = await this.verifyOptionalUserId(authz);
    const results = await this.userService.searchBrands(query, limitNum, userId);
    return { brands: results };
  }

  @Post("brands/:brandId/fetch-logo")
  async fetchBrandLogo(@Param("brandId") brandId: string) {
    return this.userService.fetchBrandLogo(brandId);
  }

  @Get("interests")
  async getInterests(@Query("q") query?: string, @Query("limit") limit?: string) {
    if (query === undefined || query === null || query === "") {
      const limitNum = limit !== undefined && limit !== "" ? parseInt(limit, 10) : 8;
      if (isNaN(limitNum) || limitNum < 1 || limitNum > 50) {
        throw new HttpException("Limit must be between 1 and 50", HttpStatus.BAD_REQUEST);
      }
      return this.userService.getInterests(limitNum);
    }

    const trimmedQuery = query.trim();
    if (trimmedQuery.length === 0) {
      throw new HttpException("Search query (q) is required", HttpStatus.BAD_REQUEST);
    }

    const limitNum = limit !== undefined && limit !== "" ? parseInt(limit, 10) : SEARCH_DEFAULT_LIMIT;
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 50) {
      throw new HttpException("Limit must be between 1 and 50", HttpStatus.BAD_REQUEST);
    }

    return this.userService.searchInterests(trimmedQuery, limitNum);
  }

  @Get("values")
  async getValues(@Query("q") query?: string, @Query("limit") limit?: string) {
    if (query === undefined || query === null || query === "") {
      const limitNum = limit !== undefined && limit !== "" ? parseInt(limit, 10) : 8;
      if (isNaN(limitNum) || limitNum < 1 || limitNum > 50) {
        throw new HttpException("Limit must be between 1 and 50", HttpStatus.BAD_REQUEST);
      }
      return this.userService.getValues(limitNum);
    }

    const trimmedQuery = query.trim();
    if (trimmedQuery.length === 0) {
      throw new HttpException("Search query (q) is required", HttpStatus.BAD_REQUEST);
    }

    const limitNum = limit !== undefined && limit !== "" ? parseInt(limit, 10) : SEARCH_DEFAULT_LIMIT;
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 50) {
      throw new HttpException("Limit must be between 1 and 50", HttpStatus.BAD_REQUEST);
    }

    return this.userService.searchValues(trimmedQuery, limitNum);
  }

  /* ---------- Music Preference ---------- */

  @Get("music/search")
  async searchSongs(@Query("q") query?: string, @Query("limit") limit?: string) {
    if (!query || query.trim().length === 0) {
      throw new HttpException("Search query (q) is required", HttpStatus.BAD_REQUEST);
    }
    const limitNum = limit !== undefined && limit !== "" ? parseInt(limit, 10) : SEARCH_DEFAULT_LIMIT;
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 50) {
      throw new HttpException("Limit must be between 1 and 50", HttpStatus.BAD_REQUEST);
    }
    const results = await this.musicService.searchSongs(query, limitNum);
    return { songs: results };
  }

  @Post("music/preferences")
  async createMusicPreference(@Body() body: any) {
    const dto = CreateMusicPreferenceSchema.parse(body);
    return this.userService.createOrGetMusicPreference(dto);
  }

  @Patch("me/music-preference")
  async updateMusicPreference(
    @Headers("authorization") authz: string,
    @Body() body: any
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);

    const { musicPreferenceId } = body;
    if (!musicPreferenceId || typeof musicPreferenceId !== "string") {
      throw new HttpException("musicPreferenceId is required", HttpStatus.BAD_REQUEST);
    }

    return this.userService.updateMusicPreference(token, musicPreferenceId);
  }

  /* ---------- Brand Preferences ---------- */

  @Patch("me/brand-preferences")
  async updateBrandPreferences(@Headers("authorization") authz: string, @Body() body: any) {
    const token = this.getTokenFromHeader(authz);
    if (!token) throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    const dto = UpdateBrandPreferencesSchema.parse(body);
    return this.userService.updateBrandPreferences(token, dto);
  }

  /* ---------- Interests ---------- */

  @Patch("me/interests")
  async updateInterests(@Headers("authorization") authz: string, @Body() body: any) {
    const token = this.getTokenFromHeader(authz);
    if (!token) throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    const dto = UpdateInterestsSchema.parse(body);
    return this.userService.updateInterests(token, dto);
  }

  /* ---------- Values ---------- */

  @Patch("me/values")
  async updateValues(@Headers("authorization") authz: string, @Body() body: any) {
    const token = this.getTokenFromHeader(authz);
    if (!token) throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    const dto = UpdateValuesSchema.parse(body);
    return this.userService.updateValues(token, dto);
  }

  /* ---------- Location ---------- */

  @Patch("me/location")
  async updateLocation(@Headers("authorization") authz: string, @Body() body: any) {
    const token = this.getTokenFromHeader(authz);
    if (!token) throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    const dto = UpdateLocationSchema.parse(body);
    return this.userService.updateLocation(token, dto);
  }

  @Patch("me/preferred-city")
  async updatePreferredCity(@Headers("authorization") authz: string, @Body() body: any) {
    const token = this.getTokenFromHeader(authz);
    if (!token) throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    const dto = UpdatePreferredCitySchema.parse(body);
    return this.userService.updatePreferredCity(token, dto);
  }

  /* ---------- Status ---------- */

  @Patch("me/status")
  async updateStatus(@Headers("authorization") authz: string, @Body() body: any) {
    const token = this.getTokenFromHeader(authz);
    if (!token) throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    const dto = UpdateStatusSchema.parse(body);
    return this.userService.updateStatus(token, dto);
  }

  /* ---------- Intent ---------- */

  /**
   * Get intent for a user by user ID (public endpoint, can be called from other services)
   * GET /users/:userId/intent
   */
  @Get("users/:userId/intent")
  async getIntent(@Param("userId") userId: string) {
    return this.userService.getIntent(userId);
  }

  /**
   * Update intent for authenticated user
   * PATCH /me/intent
   */
  @Patch("me/intent")
  async updateIntent(@Headers("authorization") authz: string, @Body() body: any) {
    const token = this.getTokenFromHeader(authz);
    if (!token) throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    const dto = UpdateIntentSchema.parse(body);
    return this.userService.updateIntent(token, dto);
  }

  /**
   * Get suggested intent prompts for profile creation.
   * GET /intent-prompts?limit={limit}
   */
  /**
   * Active discovery city options for onboarding / profile picker (same values as `PATCH /me/preferred-city`).
   * GET /discovery-city-options/active
   */
  @Get("discovery-city-options/active")
  async getActiveDiscoveryCityOptions() {
    return this.userService.listActiveDiscoveryCityOptions();
  }

  @Get("intent-prompts")
  async getIntentPrompts(@Query("limit") limit?: string) {
    const limitNum =
      limit !== undefined && limit !== "" ? parseInt(limit, 10) : 8;
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 20) {
      throw new HttpException("Limit must be between 1 and 20", HttpStatus.BAD_REQUEST);
    }
    return this.userService.getIntentPrompts(limitNum);
  }

  /* ---------- Horoscope ---------- */

  /**
   * Get horoscope for a user (public endpoint)
   * Other services (discovery, etc.) and frontend can call this
   * GET /users/:userId/horoscope
   */
  @Get("users/:userId/horoscope")
  async getHoroscope(@Param("userId") userId: string) {
    return this.userService.getHoroscope(userId);
  }

  /**
   * Get own horoscope (authenticated endpoint)
   * GET /me/horoscope
   */
  @Get("me/horoscope")
  async getMyHoroscope(@Headers("authorization") authz?: string) {
    const token = this.getTokenFromHeader(authz);
    if (!token) throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);

    // Verify token and get userId
    const { verifyToken } = await import("@hmm/common");
    const jwkStr = process.env.JWT_PUBLIC_JWK;
    if (!jwkStr || jwkStr === "undefined") {
      throw new HttpException("Server configuration error", HttpStatus.INTERNAL_SERVER_ERROR);
    }
    const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
    const publicJwk = JSON.parse(cleanedJwk);
    const verifyAccess = await verifyToken(publicJwk);
    const payload = await verifyAccess(token);

    return this.userService.getHoroscope(payload.sub);
  }

  /* ---------- Zodiac ---------- */

  /**
   * List all zodiac options (public; used for profile picker).
   * GET /zodiacs
   */
  @Get("zodiacs")
  async listZodiacs() {
    return this.userService.listZodiacs();
  }

  /**
   * Update authenticated user's zodiac (override).
   * PATCH /me/zodiac
   */
  @Patch("me/zodiac")
  async updateMyZodiac(@Body() body: unknown, @Headers("authorization") authz?: string) {
    const token = this.getTokenFromHeader(authz);
    if (!token) throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    const dto = UpdateZodiacSchema.parse(body) as { zodiacId: string };
    return this.userService.updateMyZodiac(token, dto);
  }

  /* ---------- Reporting ---------- */

  /**
   * Report a user (universal API: use from any screen)
   * POST /users/report
   *
   * Allows any authenticated user to report another user.
   * Optional reportType maps to a configurable weight (env REPORT_WEIGHT_*).
   * reportCount stores the weighted sum; at/above REPORT_THRESHOLD the user is excluded from the discovery pool
   * (and user-service moderation tripwire applies). Discovery UI tiers use DISCOVERY_REPORT_LAYER_* below that.
   */
  @Post("users/report")
  async reportUser(@Headers("authorization") authz: string, @Body() body: any) {
    const token = this.getTokenFromHeader(authz);
    if (!token) throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);

    const { reportedUserId, reportType } = body;
    if (!reportedUserId || typeof reportedUserId !== "string") {
      throw new HttpException("reportedUserId is required", HttpStatus.BAD_REQUEST);
    }
    if (reportType !== undefined && typeof reportType !== "string") {
      throw new HttpException("reportType must be a string if provided", HttpStatus.BAD_REQUEST);
    }

    return this.userService.reportUser(token, reportedUserId, reportType);
  }

  /* ---------- Batch Operations ---------- */

  @Post("users/batch")
  async getUsersByIds(@Body() body: any) {
    const { userIds } = body;
    if (!Array.isArray(userIds) || userIds.length === 0) {
      throw new HttpException("userIds array is required", HttpStatus.BAD_REQUEST);
    }
    return this.userService.getUsersByIds(userIds);
  }

  @Get("users/nearby")
  async getUsersNearby(
    @Query("latitude") latitude: string,
    @Query("longitude") longitude: string,
    @Query("radius") radius?: string,
    @Query("limit") limit?: string
  ) {
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    const radiusKm = radius !== undefined && radius !== "" ? parseFloat(radius) : NEARBY_DEFAULT_RADIUS_KM;
    const limitNum = limit !== undefined && limit !== "" ? parseInt(limit, 10) : NEARBY_DEFAULT_LIMIT;

    if (isNaN(lat) || isNaN(lng)) {
      throw new HttpException("Valid latitude and longitude are required", HttpStatus.BAD_REQUEST);
    }

    return this.userService.getUsersNearby(lat, lng, radiusKm, limitNum);
  }

  /* ---------- Metrics ---------- */

  @Get("metrics/cities")
  async getCitiesWithMaxUsers(@Query("limit") limit?: string) {
    const limitNum = limit !== undefined && limit !== "" ? parseInt(limit, 10) : CITIES_MAX_USERS_DEFAULT_LIMIT;
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      throw new HttpException("Limit must be between 1 and 100", HttpStatus.BAD_REQUEST);
    }
    return this.userService.getCitiesWithMaxUsers(limitNum);
  }

  /** Returns total user profiles (all statuses). Path name kept for API compatibility. */
  @Get("metrics/active-meetings")
  async getActiveMeetingsCount() {
    const count = await this.userService.getActiveMeetingsCount();
    return { count };
  }

  @Get("metrics/anywhere-count")
  async getAnywhereUsersCount() {
    const count = await this.userService.getAnywhereUsersCount();
    return { count };
  }

  /* ---------- Discovery ---------- */

  @Post("users/discovery")
  async getUsersForDiscovery(@Body() body: any) {
    const {
      city,
      statuses,
      genders,
      excludeUserIds,
      limit,
      includeModerators,
      excludeModerators,
      onlyModerators,
      excludeKycStatuses
    } = body;

    if (!Array.isArray(statuses) || statuses.length === 0) {
      throw new HttpException("statuses array is required", HttpStatus.BAD_REQUEST);
    }

    // Convert string statuses to UserStatus enum
    const validStatuses = [
      "AVAILABLE",
      "IN_SQUAD_AVAILABLE",
      "IN_BROADCAST_AVAILABLE",
      "ONLINE",
      "OFFLINE",
      "VIEWER"
    ];
    const invalidStatuses = statuses.filter((s: string) => !validStatuses.includes(s));
    if (invalidStatuses.length > 0) {
      throw new HttpException(
        `Invalid statuses: ${invalidStatuses.join(", ")}. Valid statuses: ${validStatuses.join(", ")}`,
        HttpStatus.BAD_REQUEST
      );
    }

    const limitNum = limit !== undefined && limit !== "" ? parseInt(String(limit), 10) : DISCOVERY_USERS_DEFAULT_LIMIT;
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 500) {
      throw new HttpException("Limit must be between 1 and 500", HttpStatus.BAD_REQUEST);
    }

    return this.userService.getUsersForDiscovery({
      city: city !== undefined ? city : null,
      statuses: statuses as UserStatus[],
      genders,
      excludeUserIds,
      includeModerators: includeModerators === undefined ? undefined : Boolean(includeModerators),
      excludeModerators: excludeModerators === undefined ? undefined : Boolean(excludeModerators),
      onlyModerators: onlyModerators === undefined ? undefined : Boolean(onlyModerators),
      excludeKycStatuses: Array.isArray(excludeKycStatuses)
        ? excludeKycStatuses.filter((v: string) => ["UNVERIFIED", "VERIFIED", "PENDING_REVIEW", "REVOKED", "EXPIRED"].includes(v)) as any[]
        : undefined,
      limit: limitNum
    });
  }

  @Get("users/internal/:userId/kyc")
  async getKycSnapshot(@Param("userId") userId: string) {
    return this.userService.getKycSnapshot(userId);
  }

  @Post("users/internal/:userId/kyc")
  async updateKycSnapshot(@Param("userId") userId: string, @Body() body: any) {
    const parsed = z.object({
      kycStatus: z.enum(["UNVERIFIED", "VERIFIED", "PENDING_REVIEW", "REVOKED", "EXPIRED"]).optional(),
      kycRiskScore: z.number().int().min(0).max(100).optional(),
      kycExpiresAt: z.string().datetime().nullable().optional(),
      isModerator: z.boolean().optional()
    }).parse(body ?? {});

    return this.userService.adminSetKycState(userId, {
      kycStatus: parsed.kycStatus as any,
      kycRiskScore: parsed.kycRiskScore,
      kycExpiresAt: parsed.kycExpiresAt !== undefined ? (parsed.kycExpiresAt ? new Date(parsed.kycExpiresAt) : null) : undefined,
      isModerator: parsed.isModerator
    });
  }

  /**
   * Internal: update user status (discovery / squad flows). Requires x-service-token.
   * PATCH /users/internal/:userId/status
   */
  @Patch("users/internal/:userId/status")
  async updateStatusInternal(
    @Headers("x-service-token") serviceToken: string | undefined,
    @Param("userId") userId: string,
    @Body() body: unknown
  ) {
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

    const dto = UpdateStatusSchema.parse(body);
    return this.userService.updateStatusForUser(userId, dto);
  }

  /* ---------- Test Endpoints (No Auth Required) ---------- */

  /**
   * Test endpoint: Get profile (bypasses auth)
   * GET /users/test/:userId?fields=xxx
   */
  @Get("users/test/:userId")
  async getProfileTest(@Param("userId") userId: string, @Query("fields") fields?: string) {
    const fieldArray = fields ? fields.split(",").map(f => f.trim()).filter(Boolean) : undefined;
    return this.userService.getProfile(userId, fieldArray);
  }

  /**
   * Test endpoint: Create profile (bypasses auth)
   * POST /users/test/:userId/profile
   */
  @Post("users/test/:userId/profile")
  async createProfileTest(@Param("userId") userId: string, @Body() body: any) {
    const dto = CreateProfileSchema.parse(body);
    return this.userService.createProfile(userId, dto);
  }

  /**
   * Test endpoint: Get profile completion (bypasses auth)
   * GET /users/test/:userId/profile-completion
   */
  @Get("users/test/:userId/profile-completion")
  async getProfileCompletionTest(@Param("userId") userId: string) {
    return this.userService.getProfileCompletion(userId);
  }

  /**
   * Test endpoint: Update profile (bypasses auth)
   * PATCH /users/test/:userId/profile
   */
  @Patch("users/test/:userId/profile")
  async updateProfileTest(@Param("userId") userId: string, @Body() body: any) {
    const dto = UpdateProfileSchema.parse(body);
    return this.userService.updateProfileForUser(userId, dto);
  }

  /**
   * Test endpoint: Get photos (bypasses auth)
   * GET /users/test/:userId/photos
   */
  @Get("users/test/:userId/photos")
  async getPhotosTest(@Param("userId") userId: string) {
    return this.userService.getPhotos(userId);
  }

  /**
   * Test endpoint: Add photo (bypasses auth)
   * POST /users/test/:userId/photos
   */
  @Post("users/test/:userId/photos")
  async addPhotoTest(@Param("userId") userId: string, @Body() body: any) {
    const dto = CreatePhotoSchema.parse(body);
    return this.userService.addPhotoForUser(userId, dto);
  }

  /**
   * Test endpoint: Delete photo (bypasses auth)
   * DELETE /users/test/:userId/photos/:photoId
   */
  @Delete("users/test/:userId/photos/:photoId")
  async deletePhotoTest(@Param("userId") userId: string, @Param("photoId") photoId: string) {
    return this.userService.deletePhotoForUser(userId, photoId);
  }

  /**
   * Test endpoint: Update music preference (bypasses auth)
   * PATCH /users/test/:userId/music-preference
   */
  @Patch("users/test/:userId/music-preference")
  async updateMusicPreferenceTest(@Param("userId") userId: string, @Body() body: any) {
    const { musicPreferenceId } = body;
    if (!musicPreferenceId || typeof musicPreferenceId !== "string") {
      throw new HttpException("musicPreferenceId is required", HttpStatus.BAD_REQUEST);
    }
    return this.userService.updateMusicPreferenceForUser(userId, musicPreferenceId);
  }

  /**
   * Test endpoint: Update brand preferences (bypasses auth)
   * PATCH /users/test/:userId/brand-preferences
   */
  @Patch("users/test/:userId/brand-preferences")
  async updateBrandPreferencesTest(@Param("userId") userId: string, @Body() body: any) {
    const dto = UpdateBrandPreferencesSchema.parse(body);
    return this.userService.updateBrandPreferencesForUser(userId, dto);
  }

  /**
   * Test endpoint: Update interests (bypasses auth)
   * PATCH /users/test/:userId/interests
   */
  @Patch("users/test/:userId/interests")
  async updateInterestsTest(@Param("userId") userId: string, @Body() body: any) {
    const dto = UpdateInterestsSchema.parse(body);
    return this.userService.updateInterestsForUser(userId, dto);
  }

  /**
   * Test endpoint: Update values (bypasses auth)
   * PATCH /users/test/:userId/values
   */
  @Patch("users/test/:userId/values")
  async updateValuesTest(@Param("userId") userId: string, @Body() body: any) {
    const dto = UpdateValuesSchema.parse(body);
    return this.userService.updateValuesForUser(userId, dto);
  }

  /**
   * Test endpoint: Update location (bypasses auth)
   * PATCH /users/test/:userId/location
   */
  @Patch("users/test/:userId/location")
  async updateLocationTest(@Param("userId") userId: string, @Body() body: any) {
    const dto = UpdateLocationSchema.parse(body);
    return this.userService.updateLocationForUser(userId, dto);
  }

  /**
   * Test endpoint: Update preferred city (bypasses auth)
   * PATCH /users/test/:userId/preferred-city
   */
  @Patch("users/test/:userId/preferred-city")
  async updatePreferredCityTest(@Param("userId") userId: string, @Body() body: any) {
    const dto = UpdatePreferredCitySchema.parse(body);
    return this.userService.updatePreferredCityForUser(userId, dto);
  }

  /**
   * Test endpoint: Update status (bypasses auth)
   * PATCH /users/test/:userId/status
   */
  @Patch("users/test/:userId/status")
  async updateStatusTest(@Param("userId") userId: string, @Body() body: any) {
    const dto = UpdateStatusSchema.parse(body);
    return this.userService.updateStatusForUser(userId, dto);
  }

  /**
   * Test endpoint: Get horoscope (bypasses auth)
   * GET /users/test/:userId/horoscope
   */
  @Get("users/test/:userId/horoscope")
  async getHoroscopeTest(@Param("userId") userId: string) {
    return this.userService.getHoroscope(userId);
  }

  /* ---------- Account Management Endpoints ---------- */

  /**
   * Export user data (GDPR compliance)
   * GET /me/export
   */
  @Get("me/export")
  async exportUserData(@Headers("authorization") authz: string) {
    const token = this.getTokenFromHeader(authz);
    if (!token) throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);

    // Verify token and get userId
    const { verifyToken } = await import("@hmm/common");
    const jwkStr = process.env.JWT_PUBLIC_JWK;
    if (!jwkStr || jwkStr === "undefined") {
      throw new HttpException("Server configuration error", HttpStatus.INTERNAL_SERVER_ERROR);
    }
    const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
    const publicJwk = JSON.parse(cleanedJwk);
    const verifyAccess = await verifyToken(publicJwk);
    const payload = await verifyAccess(token);

    return this.userService.exportUserData(payload.sub);
  }

  /**
   * Test endpoint: Delete user (bypasses auth)
   * DELETE /users/test/:userId
   */
  @Delete("users/test/:userId")
  async deleteUserTest(@Param("userId") userId: string) {
    try {
      await this.userService.deleteUserAccount(userId);
      return { success: true, message: `User ${userId} deleted successfully` };
    } catch (error: any) {
      if (error.code === "P2025") {
        // User doesn't exist
        throw new HttpException("User not found", HttpStatus.NOT_FOUND);
      }
      throw error;
    }
  }

  /**
   * Delete user account (internal endpoint, called by auth-service)
   * DELETE /users/internal/:userId
   * Note: This should be protected by internal service authentication
   */
  @Delete("users/internal/:userId")
  async deleteUserAccountInternal(@Param("userId") userId: string) {
    // TODO: Add internal service authentication
    await this.userService.deleteUserAccount(userId);
    return { ok: true, message: `User account ${userId} deleted` };
  }
}

