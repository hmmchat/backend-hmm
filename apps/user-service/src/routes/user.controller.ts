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
  CreateMusicPreferenceSchema
} from "../dtos/profile.dto.js";
import { UserStatus } from "@prisma/client";

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
  async getBrands() {
    return this.userService.getBrands();
  }

  @Get("interests")
  async getInterests() {
    return this.userService.getInterests();
  }

  @Get("values")
  async getValues() {
    return this.userService.getValues();
  }

  /* ---------- Music Preference ---------- */

  @Get("music/search")
  async searchSongs(@Query("q") query?: string, @Query("limit") limit?: string) {
    if (!query || query.trim().length === 0) {
      throw new HttpException("Search query (q) is required", HttpStatus.BAD_REQUEST);
    }
    const limitNum = limit ? parseInt(limit, 10) : 20;
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
    const radiusKm = radius ? parseFloat(radius) : 10;
    const limitNum = limit ? parseInt(limit, 10) : 50;

    if (isNaN(lat) || isNaN(lng)) {
      throw new HttpException("Valid latitude and longitude are required", HttpStatus.BAD_REQUEST);
    }

    return this.userService.getUsersNearby(lat, lng, radiusKm, limitNum);
  }

  /* ---------- Metrics ---------- */

  @Get("metrics/cities")
  async getCitiesWithMaxUsers(@Query("limit") limit?: string) {
    const limitNum = limit ? parseInt(limit, 10) : 20;
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      throw new HttpException("Limit must be between 1 and 100", HttpStatus.BAD_REQUEST);
    }
    return this.userService.getCitiesWithMaxUsers(limitNum);
  }

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
    const { city, statuses, genders, excludeUserIds, limit } = body;

    if (!Array.isArray(statuses) || statuses.length === 0) {
      throw new HttpException("statuses array is required", HttpStatus.BAD_REQUEST);
    }

    // Convert string statuses to UserStatus enum
    const validStatuses = [
      "AVAILABLE",
      "IN_SQUAD_AVAILABLE",
      "IN_BROADCAST_AVAILABLE"
    ];
    const invalidStatuses = statuses.filter((s: string) => !validStatuses.includes(s));
    if (invalidStatuses.length > 0) {
      throw new HttpException(
        `Invalid statuses: ${invalidStatuses.join(", ")}. Valid statuses: ${validStatuses.join(", ")}`,
        HttpStatus.BAD_REQUEST
      );
    }

    const limitNum = limit ? parseInt(String(limit), 10) : 100;
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 500) {
      throw new HttpException("Limit must be between 1 and 500", HttpStatus.BAD_REQUEST);
    }

    return this.userService.getUsersForDiscovery({
      city: city !== undefined ? city : null,
      statuses: statuses as UserStatus[],
      genders,
      excludeUserIds,
      limit: limitNum
    });
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
}

