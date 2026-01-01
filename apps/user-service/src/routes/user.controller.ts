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
  UpdateStatusSchema,
  CreateMusicPreferenceSchema
} from "../dtos/profile.dto.js";

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
}

