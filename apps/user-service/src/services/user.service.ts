// @ts-nocheck - Workspace Prisma client type resolution issues
import { Injectable, HttpException, HttpStatus, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { ProfileCompletionService } from "./profile-completion.service.js";
import { ModerationClientService } from "./moderation-client.service.js";
import { BrandService } from "./brand.service.js";
import { WalletClientService } from "./wallet-client.service.js";
import { AuthClientService } from "./auth-client.service.js";
import { verifyToken, AccessPayload } from "@hmm/common";
import { JWK } from "jose";
import {
  CreateProfileDto,
  UpdateProfileDto,
  CreatePhotoDto,
  UpdateBrandPreferencesDto,
  UpdateInterestsDto,
  UpdateValuesDto,
  UpdateLocationDto,
  UpdatePreferredCityDto,
  UpdateStatusDto,
  UpdateIntentDto,
  CreateMusicPreferenceDto
} from "../dtos/profile.dto.js";
import { Gender, UserStatus } from "../../node_modules/.prisma/client/index.js";
import {
  NEARBY_DEFAULT_RADIUS_KM,
  NEARBY_DEFAULT_LIMIT,
  CITIES_MAX_USERS_DEFAULT_LIMIT,
  DISCOVERY_USERS_DEFAULT_LIMIT,
  SEARCH_DEFAULT_LIMIT
} from "../config/limits.config.js";
import { getReportWeight } from "../config/report-weights.config.js";

@Injectable()
export class UserService implements OnModuleInit {
  private verifyAccess!: (token: string) => Promise<AccessPayload>;
  private publicJwk!: JWK;

  constructor(
    private readonly prisma: PrismaService,
    private readonly profileCompletion: ProfileCompletionService,
    private readonly moderationClient: ModerationClientService,
    private readonly brandService: BrandService,
    private readonly walletClient: WalletClientService,
    private readonly authClient: AuthClientService
  ) { }

  async onModuleInit() {
    // Validate database schema exists
    try {
      // Try a simple query to verify the users table exists
      await this.prisma.$queryRaw`SELECT 1 FROM users LIMIT 1`;
    } catch (error: any) {
      const errorMessage = error?.message || String(error);
      if (errorMessage.includes("does not exist") || errorMessage.includes("relation") || errorMessage.includes("table")) {
        throw new Error(
          `Database schema not initialized! The 'users' table does not exist.\n` +
          `This is a CRITICAL error that will cause all requests to fail.\n\n` +
          `To fix:\n` +
          `1. Run: cd apps/user-service && npx prisma db push\n` +
          `2. Or run the setup script: ./scripts/setup-and-start-services.sh\n` +
          `3. For production, use: npx prisma migrate deploy\n\n` +
          `Original error: ${errorMessage}`
        );
      }
      // If it's a different error (like connection issue), let it propagate
      throw error;
    }

    // Load JWT public key for token verification
    const jwkStr = process.env.JWT_PUBLIC_JWK;
    if (!jwkStr || jwkStr === "undefined") {
      throw new Error("JWT_PUBLIC_JWK environment variable is not set or is invalid");
    }

    // Remove surrounding quotes if present
    const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
    this.publicJwk = JSON.parse(cleanedJwk) as JWK;

    this.verifyAccess = await verifyToken(this.publicJwk);
  }

  /* ---------- Token Verification ---------- */
  private async verifyAccessToken(accessToken: string): Promise<string> {
    try {
      console.log(`[UserService] Verifying token: ${accessToken.substring(0, 20)}...`);
      const payload = await this.verifyAccess(accessToken);
      console.log(`[UserService] Token verified for user: ${payload.sub}`);
      return payload.sub; // user id
    } catch (error: any) {
      console.error(`[UserService] Token verification failed:`, error.message || error);
      throw new HttpException("Invalid or expired token", HttpStatus.UNAUTHORIZED);
    }
  }

  /* ---------- Profile Management ---------- */

  async createProfile(userId: string, data: CreateProfileDto) {
    try {
      // Check if profile already exists
      const existing = await this.prisma.user.findUnique({
        where: { id: userId }
      });

      if (existing) {
        throw new HttpException("Profile already exists", HttpStatus.BAD_REQUEST);
      }

      // Username is not required to be unique - can be common names like "John", "Sarah"

      // Validate date of birth (user must be at least 18 years old)
      const age = new Date().getFullYear() - data.dateOfBirth.getFullYear();
      if (age < 18) {
        throw new HttpException("User must be at least 18 years old", HttpStatus.BAD_REQUEST);
      }

      // Validate display picture for NSFW content - MUST be checked before creating profile
      // This will throw HttpException if image is unsafe or service is unavailable
      try {
        await this.moderationClient.checkImage(data.displayPictureUrl);
      } catch (error) {
        // In dev/test mode, allow images if moderation check fails
        const isDevOrTest =
          process.env.NODE_ENV === "test" ||
          process.env.NODE_ENV === "development" ||
          !process.env.NODE_ENV;

        if (isDevOrTest) {
          console.warn(`Moderation check failed in dev/test mode, allowing image: ${error instanceof Error ? error.message : String(error)}`);
          // Continue with profile creation
        } else {
          // In production, re-throw the error
          throw error;
        }
      }

      // Create user profile
      const user = await this.prisma.user.create({
        data: {
          id: userId, // Use the same ID from auth-service
          username: data.username,
          dateOfBirth: data.dateOfBirth,
          gender: data.gender as Gender,
          displayPictureUrl: data.displayPictureUrl,
          intent: data.intent,
          profileCompleted: true,
          genderChanged: data.gender === "PREFER_NOT_TO_SAY" ? false : true
        },
        include: {
          photos: true,
          musicPreference: true,
          brandPreferences: { include: { brand: true } },
          interests: { include: { interest: true } },
          values: { include: { value: true } }
        }
      });

      // Calculate profile completion percentage
      const completion = await this.profileCompletion.calculateCompletion(userId);

      // Process referral reward (non-blocking - profile creation already succeeded)
      this.processReferralReward(userId).catch((error) => {
        // Log error but don't throw - profile creation already succeeded
        console.error(`Error processing referral reward for user ${userId}:`, error);
      });

      return { user, profileCompletion: completion };
    } catch (error) {
      // Log the actual error for debugging
      console.error("Error in createProfile:", error);
      if (error instanceof HttpException) {
        throw error;
      }
      // Re-throw as HttpException with proper status
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Provide helpful error message if database schema is missing
      if (errorMessage.includes("does not exist") || errorMessage.includes("relation") || errorMessage.includes("table")) {
        throw new HttpException(
          `Database schema not initialized! The required table does not exist.\n` +
          `Error: ${errorMessage}\n\n` +
          `To fix:\n` +
          `1. Run: cd apps/user-service && npx prisma db push\n` +
          `2. Or run the setup script: ./scripts/setup-and-start-services.sh\n` +
          `3. For production, use: npx prisma migrate deploy`,
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      }

      throw new HttpException(
        `Failed to create profile: ${errorMessage}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Process referral reward when profile is completed
   * This is called asynchronously after profile creation succeeds
   */
  private async processReferralReward(userId: string): Promise<void> {
    try {
      // Get referral status from auth-service
      const referralStatus = await this.authClient.getReferralStatus(userId);

      // If no referral or already claimed, skip
      if (!referralStatus || !referralStatus.referredBy || referralStatus.referralRewardClaimed) {
        return;
      }

      // Verify referrer account is still active before awarding rewards
      const referrerId = referralStatus.referredBy;
      const isReferrerActive = await this.authClient.isAccountActive(referrerId);

      if (!isReferrerActive) {
        console.warn(`Referrer ${referrerId} is not active, skipping referral reward for user ${userId}`);
        // Mark as claimed to prevent retry attempts
        await this.authClient.markReferralClaimed(userId);
        return;
      }

      // Prevent self-referral (additional safety check)
      if (referrerId === userId) {
        console.warn(`Self-referral detected for user ${userId}, skipping reward`);
        await this.authClient.markReferralClaimed(userId);
        return;
      }

      // Get reward amounts from environment variables (with defaults)
      const referrerReward = parseInt(process.env.REFERRAL_REWARD_REFERRER || "100", 10);
      const referredReward = parseInt(process.env.REFERRAL_REWARD_REFERRED || "50", 10);

      // Award coins to both referrer and referred user
      await this.walletClient.awardReferralRewards(
        referrerId,
        userId,
        referrerReward,
        referredReward
      );

      // Mark referral as claimed in auth-service
      await this.authClient.markReferralClaimed(userId);

      console.log(`Referral rewards awarded: ${referrerReward} coins to ${referrerId}, ${referredReward} coins to ${userId}`);
    } catch (error) {
      // Log error but don't throw - this is non-blocking
      console.error(`Error processing referral reward for user ${userId}:`, error);
      // Don't re-throw - profile creation already succeeded
    }
  }

  async getProfile(userId: string, fields?: string[]) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        photos: { orderBy: { order: "asc" } },
        musicPreference: true,
        brandPreferences: {
          include: { brand: true },
          orderBy: { order: "asc" }
        },
        interests: {
          include: { interest: true },
          orderBy: { order: "asc" }
        },
        values: {
          include: { value: true },
          orderBy: { order: "asc" }
        }
      }
    });

    if (!user) {
      throw new HttpException("User profile not found", HttpStatus.NOT_FOUND);
    }

    // Get active badge if user has one (optional - don't break if badge fetch fails)
    let activeBadge = null;
    if (user.activeBadgeId) {
      try {
        const badge = await this.prisma.userBadge.findUnique({
          where: {
            userId_giftId: {
              userId: user.id,
              giftId: user.activeBadgeId
            }
          }
        });
        if (badge) {
          activeBadge = {
            giftId: badge.giftId,
            giftName: badge.giftName,
            giftEmoji: badge.giftEmoji
          };
        }
        // If badge not found (activeBadgeId set but badge doesn't exist), activeBadge stays null
      } catch (error: any) {
        // Badge fetch failed - log but don't break user profile fetch
        // Badges are optional, so we continue without badge
        console.warn(`[WARN] Failed to fetch badge for user ${user.id}:`, error?.message || error);
        // activeBadge remains null - user will have no badge
      }
    }
    // If user has no activeBadgeId, activeBadge is already null

    // Add activeBadge to user object (null if no badge or fetch failed)
    (user as any).activeBadge = activeBadge;

    // If fields are specified, filter the response
    let filteredUser: any = user;
    if (fields && fields.length > 0) {
      filteredUser = this.filterUserFields(user, fields);
    }

    // Calculate profile completion percentage (only if not filtering or if completion is requested)
    let completion;
    const shouldIncludeCompletion = !fields || fields.length === 0 || fields.includes("profileCompletion");

    if (shouldIncludeCompletion) {
      try {
        completion = await this.profileCompletion.calculateCompletion(userId);
      } catch (error) {
        console.error("Error calculating profile completion:", error);
        // If calculation fails, return a default completion object
        completion = {
          percentage: 0,
          completed: 0,
          total: 0,
          details: {
            required: {
              username: !!user.username,
              dateOfBirth: !!user.dateOfBirth,
              gender: !!user.gender,
              displayPictureUrl: !!user.displayPictureUrl
            },
            optional: {
              photos: { filled: user.photos.length, max: 3 },
              musicPreference: !!user.musicPreferenceId,
              brandPreferences: { filled: user.brandPreferences.length, max: 5 },
              interests: { filled: user.interests.length, max: 1 },
              values: { filled: user.values.length, max: 1 },
              intent: !!user.intent
            }
          }
        };
      }
    }

    const result: any = { user: filteredUser };
    if (completion !== undefined) {
      result.profileCompletion = completion;
    }

    return result;
  }

  /**
   * Filter user object to include only specified fields
   * Supports nested fields like "photos.url", "musicPreference.name"
   */
  private filterUserFields(user: any, fields: string[]): any {
    const filtered: any = {};

    // Always include id
    filtered.id = user.id;

    // Map of field paths to their actual locations in user object
    const fieldMap: Record<string, string> = {
      // Basic fields
      username: "username",
      dateOfBirth: "dateOfBirth",
      gender: "gender",
      displayPictureUrl: "displayPictureUrl",
      status: "status",
      intent: "intent",
      latitude: "latitude",
      longitude: "longitude",
      videoEnabled: "videoEnabled",
      profileCompleted: "profileCompleted",
      genderChanged: "genderChanged",
      reportCount: "reportCount",
      badgeMember: "badgeMember",
      createdAt: "createdAt",
      updatedAt: "updatedAt",
      locationUpdatedAt: "locationUpdatedAt",
      preferredCity: "preferredCity",
      // Relation fields
      photos: "photos",
      musicPreference: "musicPreference",
      brandPreferences: "brandPreferences",
      interests: "interests",
      values: "values",
      activeBadge: "activeBadge",
      activeBadgeId: "activeBadgeId"
    };

    for (const field of fields) {
      const fieldPath = fieldMap[field];
      if (fieldPath && user[fieldPath] !== undefined) {
        filtered[field] = user[fieldPath];
      }
    }

    return filtered;
  }

  async updateProfile(accessToken: string, data: UpdateProfileDto) {
    const userId = await this.verifyAccessToken(accessToken);

    const existingUser = await this.prisma.user.findUnique({
      where: { id: userId }
    });

    if (!existingUser) {
      throw new HttpException("User profile not found", HttpStatus.NOT_FOUND);
    }

    // Username is not required to be unique - can be common names like "John", "Sarah"

    // Gender change validation: Can only change once from PREFER_NOT_TO_SAY to any other
    if (data.gender) {
      if (existingUser.gender === "PREFER_NOT_TO_SAY" && !existingUser.genderChanged) {
        // Allow change from PREFER_NOT_TO_SAY to any other
        // Update will proceed with genderChanged = true
      } else if (existingUser.gender !== "PREFER_NOT_TO_SAY") {
        throw new HttpException(
          "Gender cannot be changed. It can only be changed once from 'prefer not to say' to another value.",
          HttpStatus.BAD_REQUEST
        );
      } else if (existingUser.genderChanged) {
        throw new HttpException(
          "Gender has already been changed once and cannot be changed again",
          HttpStatus.BAD_REQUEST
        );
      }
    }

    // Update user
    const updateData: any = {};
    if (data.username) updateData.username = data.username;
    if (data.gender) {
      updateData.gender = data.gender as Gender;
      updateData.genderChanged = true;
    }
    if (data.displayPictureUrl !== undefined) updateData.displayPictureUrl = data.displayPictureUrl;
    if (data.intent !== undefined) updateData.intent = data.intent;
    if (data.musicPreferenceId !== undefined) updateData.musicPreferenceId = data.musicPreferenceId;
    if (data.videoEnabled !== undefined) updateData.videoEnabled = data.videoEnabled;

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: updateData,
      include: {
        photos: { orderBy: { order: "asc" } },
        musicPreference: true,
        brandPreferences: {
          include: { brand: true },
          orderBy: { order: "asc" }
        },
        interests: {
          include: { interest: true },
          orderBy: { order: "asc" }
        },
        values: {
          include: { value: true },
          orderBy: { order: "asc" }
        }
      }
    });

    // Get active badge if user has one (optional - don't break if badge fetch fails)
    let activeBadge = null;
    if (user.activeBadgeId) {
      try {
        const badge = await this.prisma.userBadge.findUnique({
          where: {
            userId_giftId: {
              userId: user.id,
              giftId: user.activeBadgeId
            }
          }
        });
        if (badge) {
          activeBadge = {
            giftId: badge.giftId,
            giftName: badge.giftName,
            giftEmoji: badge.giftEmoji
          };
        }
        // If badge not found (activeBadgeId set but badge doesn't exist), activeBadge stays null
      } catch (error: any) {
        // Badge fetch failed - log but don't break user profile fetch
        // Badges are optional, so we continue without badge
        console.warn(`[WARN] Failed to fetch badge for user ${user.id}:`, error?.message || error);
        // activeBadge remains null - user will have no badge
      }
    }
    // If user has no activeBadgeId, activeBadge is already null

    // Add activeBadge to user object (null if no badge or fetch failed)
    (user as any).activeBadge = activeBadge;

    // Calculate profile completion percentage
    const completion = await this.profileCompletion.calculateCompletion(userId);

    return { user, profileCompletion: completion };
  }

  /* ---------- Photo Management ---------- */

  async getPhotos(userId: string) {
    const photos = await this.prisma.userPhoto.findMany({
      where: { userId },
      orderBy: { order: "asc" }
    });

    return { photos };
  }

  async addPhoto(accessToken: string, data: CreatePhotoDto) {
    const userId = await this.verifyAccessToken(accessToken);

    // Check current photo count (only for new photos, not updates)
    const existingPhoto = await this.prisma.userPhoto.findFirst({
      where: { userId, order: data.order }
    });

    if (!existingPhoto) {
      // Creating new photo - check if we're at the limit
      const photoCount = await this.prisma.userPhoto.count({
        where: { userId }
      });

      if (photoCount >= 3) {
        throw new HttpException("Maximum 3 photos allowed", HttpStatus.BAD_REQUEST);
      }
    }

    // Validate photo URL for NSFW content
    await this.moderationClient.checkImage(data.url);

    // Upsert: Update existing photo or create new one
    const photo = await this.prisma.userPhoto.upsert({
      where: {
        userId_order: {
          userId,
          order: data.order
        }
      },
      update: {
        url: data.url
      },
      create: {
        userId,
        url: data.url,
        order: data.order
      }
    });

    return { photo };
  }

  async deletePhoto(accessToken: string, photoId: string) {
    const userId = await this.verifyAccessToken(accessToken);

    const photo = await this.prisma.userPhoto.findFirst({
      where: { id: photoId, userId }
    });

    if (!photo) {
      throw new HttpException("Photo not found", HttpStatus.NOT_FOUND);
    }

    await this.prisma.userPhoto.delete({
      where: { id: photoId }
    });

    return { ok: true };
  }

  /* ---------- Music Preference ---------- */

  async createOrGetMusicPreference(data: CreateMusicPreferenceDto) {
    // Find or create song
    const song = await this.prisma.song.upsert({
      where: {
        name_artist: {
          name: data.songName,
          artist: data.artistName
        }
      },
      create: {
        name: data.songName,
        artist: data.artistName,
        albumArtUrl: data.albumArtUrl || null,
        spotifyId: data.spotifyId
      },
      update: {
        // Update album art and spotify ID if provided and different
        albumArtUrl: data.albumArtUrl !== undefined ? (data.albumArtUrl || null) : undefined,
        spotifyId: data.spotifyId !== undefined ? data.spotifyId : undefined
      }
    });

    return { song };
  }

  async updateMusicPreference(accessToken: string, musicPreferenceId: string) {
    const userId = await this.verifyAccessToken(accessToken);

    // Verify song exists
    const song = await this.prisma.song.findUnique({
      where: { id: musicPreferenceId }
    });

    if (!song) {
      throw new HttpException("Music preference not found", HttpStatus.NOT_FOUND);
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { musicPreferenceId },
      include: { musicPreference: true }
    });

    return { user };
  }

  /* ---------- Brand Preferences ---------- */

  async updateBrandPreferences(accessToken: string, data: UpdateBrandPreferencesDto) {
    const userId = await this.verifyAccessToken(accessToken);

    if (data.brandIds.length > 5) {
      throw new HttpException("Maximum 5 brands allowed", HttpStatus.BAD_REQUEST);
    }

    // Verify all brands exist
    const brands = await this.prisma.brand.findMany({
      where: { id: { in: data.brandIds } }
    });

    if (brands.length !== data.brandIds.length) {
      throw new HttpException("One or more brands not found", HttpStatus.NOT_FOUND);
    }

    // Delete existing preferences
    await this.prisma.userBrand.deleteMany({
      where: { userId }
    });

    // Create new preferences
    await this.prisma.userBrand.createMany({
      data: data.brandIds.map((brandId, index) => ({
        userId,
        brandId,
        order: index
      }))
    });

    const preferences = await this.prisma.userBrand.findMany({
      where: { userId },
      include: { brand: true },
      orderBy: { order: "asc" }
    });

    return { preferences };
  }

  /* ---------- Interests ---------- */

  async updateInterests(accessToken: string, data: UpdateInterestsDto) {
    const userId = await this.verifyAccessToken(accessToken);

    if (data.interestIds.length > 4) {
      throw new HttpException("Maximum 4 interests allowed", HttpStatus.BAD_REQUEST);
    }

    // Verify all interests exist
    const interests = await this.prisma.interest.findMany({
      where: { id: { in: data.interestIds } }
    });

    if (interests.length !== data.interestIds.length) {
      throw new HttpException("One or more interests not found", HttpStatus.NOT_FOUND);
    }

    // Delete existing preferences
    await this.prisma.userInterest.deleteMany({
      where: { userId }
    });

    // Create new preferences
    await this.prisma.userInterest.createMany({
      data: data.interestIds.map((interestId, index) => ({
        userId,
        interestId,
        order: index
      }))
    });

    const userInterests = await this.prisma.userInterest.findMany({
      where: { userId },
      include: { interest: true },
      orderBy: { order: "asc" }
    });

    return { interests: userInterests };
  }

  /* ---------- Values ---------- */

  async updateValues(accessToken: string, data: UpdateValuesDto) {
    const userId = await this.verifyAccessToken(accessToken);

    if (data.valueIds.length > 4) {
      throw new HttpException("Maximum 4 values allowed", HttpStatus.BAD_REQUEST);
    }

    // Verify all values exist
    const values = await this.prisma.value.findMany({
      where: { id: { in: data.valueIds } }
    });

    if (values.length !== data.valueIds.length) {
      throw new HttpException("One or more values not found", HttpStatus.NOT_FOUND);
    }

    // Delete existing preferences
    await this.prisma.userValue.deleteMany({
      where: { userId }
    });

    // Create new preferences
    await this.prisma.userValue.createMany({
      data: data.valueIds.map((valueId, index) => ({
        userId,
        valueId,
        order: index
      }))
    });

    const userValues = await this.prisma.userValue.findMany({
      where: { userId },
      include: { value: true },
      orderBy: { order: "asc" }
    });

    return { values: userValues };
  }

  /* ---------- Catalog Data (Public) ---------- */

  async getBrands(limit: number = 8) {
    const effectiveLimit = limit ?? 8;
    if (effectiveLimit < 1 || effectiveLimit > 50) {
      throw new HttpException("Limit must be between 1 and 50", HttpStatus.BAD_REQUEST);
    }

    try {
      const suggestions = await this.brandService.getBrandSuggestions(effectiveLimit);
      if (suggestions.length > 0) {
        return {
          brands: suggestions.map((b) => ({
            id: b.id,
            name: b.name,
            logoUrl: b.logoUrl
          }))
        };
      }
    } catch (error) {
      console.warn(
        `[UserService] Brandfetch suggestions unavailable, using DB fallback: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    const brands = await this.prisma.$queryRaw<
      { id: string; name: string; logoUrl: string | null }[]
    >`
      SELECT
        id,
        name,
        "logoUrl"
      FROM "brands"
      ORDER BY random()
      LIMIT ${effectiveLimit};
    `;

    return { brands };
  }

  /**
   * Search brands by name (Brandfetch primary, DB fallback)
   */
  async searchBrands(query: string, limit: number = 20) {
    return this.brandService.searchBrands(query, limit);
  }

  /**
   * Get brand by ID (kept for backward compat with POST /brands/:brandId/fetch-logo).
   * Logos are now self-managed; this returns the brand as-is.
   */
  async fetchBrandLogo(brandId: string) {
    const brand = await this.prisma.brand.findUnique({
      where: { id: brandId }
    });

    if (!brand) {
      throw new HttpException("Brand not found", HttpStatus.NOT_FOUND);
    }

    return { brand };
  }

  async getInterests(limit: number = 8) {
    const effectiveLimit = limit ?? 8;
    if (effectiveLimit < 1 || effectiveLimit > 50) {
      throw new HttpException("Limit must be between 1 and 50", HttpStatus.BAD_REQUEST);
    }

    // Only return sub-genres (name) to users, not genre
    // Genre is used internally for matching but not shown to users
    const interests = await this.prisma.$queryRaw<
      { id: string; name: string; createdAt: Date }[]
    >`
      SELECT
        id,
        name,
        "createdAt"
      FROM "interests"
      ORDER BY random()
      LIMIT ${effectiveLimit};
    `;

    return { interests };
  }

  async searchInterests(query: string, limit: number = SEARCH_DEFAULT_LIMIT) {
    const trimmedQuery = query?.trim();

    if (!trimmedQuery || trimmedQuery.length === 0) {
      throw new HttpException("Search query (q) is required", HttpStatus.BAD_REQUEST);
    }

    if (limit < 1 || limit > 50) {
      throw new HttpException("Limit must be between 1 and 50", HttpStatus.BAD_REQUEST);
    }

    let interests = await this.prisma.$queryRaw<
      { id: string; name: string; createdAt: Date }[]
    >`
      SELECT
        id,
        name,
        "createdAt"
      FROM "interests"
      WHERE lower(name) % lower(${trimmedQuery})
      ORDER BY similarity(lower(name), lower(${trimmedQuery})) DESC, name ASC
      LIMIT ${limit};
    `;

    if (interests.length === 0) {
      interests = await this.prisma.$queryRaw<
        { id: string; name: string; createdAt: Date }[]
      >`
        SELECT
          id,
          name,
          "createdAt"
        FROM "interests"
        ORDER BY similarity(lower(name), lower(${trimmedQuery})) DESC, name ASC
        LIMIT ${limit};
      `;
    }

    return { interests };
  }

  async getValues(limit: number = 8) {
    const effectiveLimit = limit ?? 8;
    if (effectiveLimit < 1 || effectiveLimit > 50) {
      throw new HttpException("Limit must be between 1 and 50", HttpStatus.BAD_REQUEST);
    }

    const values = await this.prisma.$queryRaw<
      { id: string; name: string }[]
    >`
      SELECT
        id,
        name
      FROM "values"
      ORDER BY random()
      LIMIT ${effectiveLimit};
    `;

    return { values };
  }

  async searchValues(query: string, limit: number = SEARCH_DEFAULT_LIMIT) {
    const trimmedQuery = query?.trim();

    if (!trimmedQuery || trimmedQuery.length === 0) {
      throw new HttpException("Search query (q) is required", HttpStatus.BAD_REQUEST);
    }

    if (limit < 1 || limit > 50) {
      throw new HttpException("Limit must be between 1 and 50", HttpStatus.BAD_REQUEST);
    }

    let values = await this.prisma.$queryRaw<
      { id: string; name: string }[]
    >`
      SELECT
        id,
        name
      FROM "values"
      WHERE lower(name) % lower(${trimmedQuery})
      ORDER BY similarity(lower(name), lower(${trimmedQuery})) DESC, name ASC
      LIMIT ${limit};
    `;

    if (values.length === 0) {
      values = await this.prisma.$queryRaw<
        { id: string; name: string }[]
      >`
        SELECT
          id,
          name
        FROM "values"
        ORDER BY similarity(lower(name), lower(${trimmedQuery})) DESC, name ASC
        LIMIT ${limit};
      `;
    }

    return { values };
  }

  /* ---------- Location ---------- */

  async updateLocation(accessToken: string, data: UpdateLocationDto) {
    const userId = await this.verifyAccessToken(accessToken);

    const user = await this.prisma.user.update({
      where: { id: userId },
      // @ts-ignore - Workspace Prisma client type resolution issue
      data: {
        latitude: data.latitude,
        longitude: data.longitude,
        locationUpdatedAt: new Date()
      }
    });

    return { user };
  }

  async updatePreferredCity(accessToken: string, data: UpdatePreferredCityDto) {
    const userId = await this.verifyAccessToken(accessToken);

    // Check if user exists, if not throw appropriate error
    const existingUser = await this.prisma.user.findUnique({
      where: { id: userId }
    });

    if (!existingUser) {
      throw new HttpException("User profile not found", HttpStatus.NOT_FOUND);
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        preferredCity: data.city
      } as any // Type assertion needed due to workspace Prisma client resolution
    });

    return { city: (user as any).preferredCity || null };
  }

  /* ---------- Status ---------- */

  async updateStatus(accessToken: string, data: UpdateStatusDto) {
    const userId = await this.verifyAccessToken(accessToken);

    const user = await this.prisma.user.update({
      where: { id: userId },
      // @ts-ignore - Workspace Prisma client type resolution issue
      data: {
        status: data.status as UserStatus
      }
    });

    return { user };
  }

  /* ---------- Intent ---------- */

  /**
   * Get intent for a user by user ID (public endpoint, can be called from other services)
   */
  async getIntent(userId: string): Promise<{ intent: string | null }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { intent: true }
    });

    if (!user) {
      throw new HttpException("User not found", HttpStatus.NOT_FOUND);
    }

    return { intent: user.intent || null };
  }

  /**
   * Update intent for authenticated user
   */
  async updateIntent(accessToken: string, data: UpdateIntentDto) {
    const userId = await this.verifyAccessToken(accessToken);

    // Check if user exists
    const existingUser = await this.prisma.user.findUnique({
      where: { id: userId }
    });

    if (!existingUser) {
      throw new HttpException("User profile not found", HttpStatus.NOT_FOUND);
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        intent: data.intent
      }
    });

    return { intent: user.intent || null };
  }

  /**
   * Get a random selection of suggested intent prompts for profile creation.
   * Returns only active prompts, shuffled, limited to the requested size (default 8).
   */
  async getIntentPrompts(limit: number = 8) {
    const effectiveLimit = limit ?? 8;
    if (effectiveLimit < 1 || effectiveLimit > 20) {
      throw new HttpException("Limit must be between 1 and 20", HttpStatus.BAD_REQUEST);
    }

    const prompts = await this.prisma.intentPrompt.findMany({
      where: { isActive: true },
      select: {
        id: true,
        text: true
      },
      orderBy: [
        { order: "asc" },
        { createdAt: "desc" }
      ]
    });

    // Shuffle in-memory and take the first N to provide randomness
    for (let i = prompts.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [prompts[i], prompts[j]] = [prompts[j], prompts[i]];
    }

    const limited = prompts.slice(0, effectiveLimit);
    return { prompts: limited };
  }

  /* ---------- Reporting ---------- */

  /**
   * Report a user
   *
   * This method allows any authenticated user to report another user.
   * It increments the reportCount (report score) on the reported user's profile by a configurable weight.
   *
   * Note: This reports the user themselves, not any stream, broadcast, or room they may be in.
   * reportCount stores the weighted sum; discovery compares it to REPORT_THRESHOLD.
   *
   * @param accessToken - JWT token of the reporting user
   * @param reportedUserId - ID of the user being reported
   * @param reportType - Optional type (e.g. face_card, offline_card, host) for configurable weight; unknown/missing uses default weight
   * @returns Object with success status and updated reportCount (total score)
   * @throws HttpException if user tries to report themselves or reported user doesn't exist
   */
  async reportUser(accessToken: string, reportedUserId: string, reportType?: string) {
    const reporterUserId = await this.verifyAccessToken(accessToken);

    if (reporterUserId === reportedUserId) {
      throw new HttpException("Cannot report yourself", HttpStatus.BAD_REQUEST);
    }

    // Check if reported user exists
    const reportedUser = await this.prisma.user.findUnique({
      where: { id: reportedUserId }
    });

    if (!reportedUser) {
      throw new HttpException("Reported user not found", HttpStatus.NOT_FOUND);
    }

    const weight = getReportWeight(reportType);

    // Increment report score (weighted sum) on the user's profile
    const updatedUser = await this.prisma.user.update({
      where: { id: reportedUserId },
      data: {
        reportCount: {
          increment: weight
        }
      }
    });

    return {
      success: true,
      reportCount: updatedUser.reportCount
    };
  }

  /* ---------- Batch Operations ---------- */

  async getUsersByIds(userIds: string[]) {
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      include: {
        photos: { orderBy: { order: "asc" }, take: 1 }, // Only first photo for list views
        musicPreference: true,
        brandPreferences: {
          include: { brand: true },
          orderBy: { order: "asc" }
        }
      } as any // Type assertion needed due to Prisma type generation issue
    });

    // Get active badges for all users (optional - don't break if badge fetch fails)
    const usersWithBadges = await Promise.all(
      users.map(async (user) => {
        let activeBadge = null;
        if (user.activeBadgeId) {
          try {
            const badge = await this.prisma.userBadge.findUnique({
              where: {
                userId_giftId: {
                  userId: user.id,
                  giftId: user.activeBadgeId
                }
              }
            });
            if (badge) {
              activeBadge = {
                giftId: badge.giftId,
                giftName: badge.giftName,
                giftEmoji: badge.giftEmoji
              };
            }
            // If badge not found (activeBadgeId set but badge doesn't exist), activeBadge stays null
          } catch (error: any) {
            // Badge fetch failed - log but don't break user profile fetch
            // Badges are optional, so we continue without badge
            console.warn(`[WARN] Failed to fetch badge for user ${user.id}:`, error?.message || error);
            // activeBadge remains null - user will have no badge
          }
        }
        // If user has no activeBadgeId, activeBadge is already null
        return { ...user, activeBadge };
      })
    );

    return { users: usersWithBadges };
  }

  async getProfileCompletion(userId: string) {
    const completion = await this.profileCompletion.calculateCompletion(userId);
    return { profileCompletion: completion };
  }

  async getUsersNearby(
    latitude: number,
    longitude: number,
    radiusKm?: number,
    limit?: number
  ) {
    const r = radiusKm ?? NEARBY_DEFAULT_RADIUS_KM;
    const l = limit ?? NEARBY_DEFAULT_LIMIT;
    // Using Haversine formula for distance calculation
    // This is a simplified version - for production, consider using PostGIS extension
    // Note: Raw SQL queries in Prisma return unknown type, so we cast it
    const users = await this.prisma.$queryRaw<Array<{
      id: string;
      username: string | null;
      dateOfBirth: Date | null;
      gender: string | null;
      displayPictureUrl: string | null;
      latitude: number | null;
      longitude: number | null;
      status: string;
      videoEnabled: boolean;
      profileCompleted: boolean;
      distance_km: number;
    }>>`
      SELECT * FROM (
        SELECT 
          id, username, "dateOfBirth", gender, "displayPictureUrl", 
          latitude, longitude, status, "videoEnabled", "profileCompleted",
          (6371 * acos(
            GREATEST(-1, LEAST(1,
              cos(radians(${latitude})) * 
              cos(radians(latitude)) * 
              cos(radians(longitude) - radians(${longitude})) + 
              sin(radians(${latitude})) * 
              sin(radians(latitude))
            ))
          )) AS distance_km
        FROM users
        WHERE latitude IS NOT NULL 
          AND longitude IS NOT NULL
          AND "profileCompleted" = true
      ) AS distance_query
      WHERE distance_km <= ${r}
      ORDER BY distance_km ASC
      LIMIT ${l}
    `;

    return { users };
  }

  /**
   * Get cities with maximum available users
   * Returns cities sorted by available user count (descending)
   * Counts users with any available status: AVAILABLE, IN_SQUAD_AVAILABLE, IN_BROADCAST_AVAILABLE
   */
  async getCitiesWithMaxUsers(
    limit?: number
  ): Promise<Array<{ city: string; availableCount: number }>> {
    const l = limit ?? CITIES_MAX_USERS_DEFAULT_LIMIT;
    // Query to get cities with available user counts (all available statuses)
    const cities = await this.prisma.$queryRaw<Array<{ city: string; count: bigint }>>`
      SELECT 
        "preferredCity" as city,
        COUNT(*)::int as count
      FROM users
      WHERE "preferredCity" IS NOT NULL
        AND "preferredCity" != ''
        AND "profileCompleted" = true
        AND status IN ('AVAILABLE', 'IN_SQUAD_AVAILABLE', 'IN_BROADCAST_AVAILABLE')
      GROUP BY "preferredCity"
      ORDER BY count DESC
      LIMIT ${l}
    `;

    // Map to response format
    return cities.map((row) => ({
      city: row.city,
      availableCount: Number(row.count)
    }));
  }

  /**
   * Get count of users with preferredCity = null (users who selected "Anywhere")
   * These are users who can see and be seen by other "Anywhere" users
   */
  async getAnywhereUsersCount(): Promise<number> {
    const result = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::int as count
      FROM users
      WHERE "preferredCity" IS NULL
        AND "profileCompleted" = true
        AND status IN ('AVAILABLE', 'IN_SQUAD_AVAILABLE', 'IN_BROADCAST_AVAILABLE')
    `;
    return Number(result[0]?.count || 0);
  }

  /**
   * Get count of users available + in calls, squad and broadcast
   * Counts users with statuses: AVAILABLE, IN_SQUAD, IN_SQUAD_AVAILABLE, IN_BROADCAST, IN_BROADCAST_AVAILABLE
   */
  async getActiveMeetingsCount(): Promise<number> {
    const count = await this.prisma.user.count({
      where: {
        status: {
          in: [
            UserStatus.AVAILABLE,
            UserStatus.IN_SQUAD,
            UserStatus.IN_SQUAD_AVAILABLE,
            UserStatus.IN_BROADCAST,
            UserStatus.IN_BROADCAST_AVAILABLE
          ]
        }
      } as any // Workspace Prisma client type resolution issue
    });
    return count;
  }

  /**
   * Get users for discovery matching
   * Filters by city, status, gender, and excludes specific user IDs
   * Excludes MATCHED users from the pool (they're already matched)
   */
  async getUsersForDiscovery(filters: {
    city?: string | null; // null means anywhere
    statuses: UserStatus[];
    genders?: ("MALE" | "FEMALE" | "NON_BINARY" | "PREFER_NOT_TO_SAY")[];
    excludeUserIds?: string[];
    limit?: number;
  }) {
    const where: any = {
      profileCompleted: true,
      status: {
        in: filters.statuses.filter(s => s !== "MATCHED") // Exclude MATCHED users from discovery pool
      } as any
    };

    // City filter
    if (filters.city !== undefined) {
      if (filters.city === null) {
        // Anywhere - show users from ALL cities (don't filter by preferredCity)
        // Users in "Anywhere" mode can see users from any city
        // Don't set where.preferredCity - this means no city filter, show all users
      } else {
        // Specific city - only match with users in that city (bidirectional)
        // Users with preferredCity = "Mumbai" should only see other users with preferredCity = "Mumbai"
        where.preferredCity = filters.city;
      }
    }

    // Gender filter
    if (filters.genders && filters.genders.length > 0) {
      where.gender = {
        in: filters.genders
      };
    }

    // Exclude user IDs
    if (filters.excludeUserIds && filters.excludeUserIds.length > 0) {
      where.id = {
        notIn: filters.excludeUserIds
      };
    }

    const users = await this.prisma.user.findMany({
      where,
      include: {
        photos: { orderBy: { order: "asc" } },
        musicPreference: true,
        brandPreferences: {
          include: { brand: true },
          orderBy: { order: "asc" }
        },
        interests: {
          include: { interest: true },
          orderBy: { order: "asc" }
        },
        values: {
          include: { value: true },
          orderBy: { order: "asc" }
        }
      },
      take: filters.limit ?? DISCOVERY_USERS_DEFAULT_LIMIT
    });

    return { users };
  }

  /* ---------- Horoscope ---------- */

  /**
   * Calculate horoscope (zodiac sign) from date of birth
   * Returns horoscope name and image URL
   */
  private calculateHoroscope(dateOfBirth: Date): { name: string; imageUrl: string } {
    const month = dateOfBirth.getMonth() + 1; // 1-12
    const day = dateOfBirth.getDate();

    let horoscope: string;

    // Determine zodiac sign based on month and day
    if ((month === 3 && day >= 21) || (month === 4 && day <= 19)) horoscope = "Aries";
    else if ((month === 4 && day >= 20) || (month === 5 && day <= 20)) horoscope = "Taurus";
    else if ((month === 5 && day >= 21) || (month === 6 && day <= 20)) horoscope = "Gemini";
    else if ((month === 6 && day >= 21) || (month === 7 && day <= 22)) horoscope = "Cancer";
    else if ((month === 7 && day >= 23) || (month === 8 && day <= 22)) horoscope = "Leo";
    else if ((month === 8 && day >= 23) || (month === 9 && day <= 22)) horoscope = "Virgo";
    else if ((month === 9 && day >= 23) || (month === 10 && day <= 22)) horoscope = "Libra";
    else if ((month === 10 && day >= 23) || (month === 11 && day <= 21)) horoscope = "Scorpio";
    else if ((month === 11 && day >= 22) || (month === 12 && day <= 21)) horoscope = "Sagittarius";
    else if ((month === 12 && day >= 22) || (month === 1 && day <= 19)) horoscope = "Capricorn";
    else if ((month === 1 && day >= 20) || (month === 2 && day <= 18)) horoscope = "Aquarius";
    else horoscope = "Pisces"; // (month === 2 && day >= 19) || (month === 3 && day <= 20)

    // Get base URL for horoscope images from environment variable
    // Images should be uploaded via files-service and stored in Cloudflare R2
    // The base URL should point to your CDN/files-service public URL
    const baseUrl = process.env.HOROSCOPE_IMAGES_BASE_URL || process.env.FILES_SERVICE_PUBLIC_URL || "https://cdn.hmmchat.live/horoscopes";
    const imageUrl = `${baseUrl}/${horoscope.toLowerCase()}.png`;

    return { name: horoscope, imageUrl };
  }

  /**
   * Get horoscope for a user by userId
   * Returns horoscope name and image URL
   * Other services can call this via the API endpoint
   */
  async getHoroscope(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { dateOfBirth: true }
    });

    if (!user) {
      throw new HttpException("User profile not found", HttpStatus.NOT_FOUND);
    }

    if (!user.dateOfBirth) {
      throw new HttpException("User date of birth is required to calculate horoscope", HttpStatus.BAD_REQUEST);
    }

    const horoscope = this.calculateHoroscope(user.dateOfBirth);
    return { horoscope };
  }

  /* ---------- Test Methods (No Auth Required) ---------- */

  /**
   * Update profile for user by ID (test endpoint, bypasses auth)
   */
  async updateProfileForUser(userId: string, data: UpdateProfileDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { id: userId }
    });

    if (!existingUser) {
      throw new HttpException("User profile not found", HttpStatus.NOT_FOUND);
    }

    // Gender change validation: Can only change once from PREFER_NOT_TO_SAY to any other
    if (data.gender) {
      if (existingUser.gender === "PREFER_NOT_TO_SAY" && !existingUser.genderChanged) {
        // Allow change from PREFER_NOT_TO_SAY to any other
      } else if (existingUser.gender !== "PREFER_NOT_TO_SAY") {
        throw new HttpException(
          "Gender cannot be changed. It can only be changed once from 'prefer not to say' to another value.",
          HttpStatus.BAD_REQUEST
        );
      } else if (existingUser.genderChanged) {
        throw new HttpException(
          "Gender has already been changed once and cannot be changed again",
          HttpStatus.BAD_REQUEST
        );
      }
    }

    // Update user
    const updateData: any = {};
    if (data.username) updateData.username = data.username;
    if (data.gender) {
      updateData.gender = data.gender as Gender;
      updateData.genderChanged = true;
    }
    if (data.intent !== undefined) updateData.intent = data.intent;
    if (data.musicPreferenceId !== undefined) updateData.musicPreferenceId = data.musicPreferenceId;
    if (data.videoEnabled !== undefined) updateData.videoEnabled = data.videoEnabled;

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: updateData,
      include: {
        photos: { orderBy: { order: "asc" } },
        musicPreference: true,
        brandPreferences: {
          include: { brand: true },
          orderBy: { order: "asc" }
        },
        interests: {
          include: { interest: true },
          orderBy: { order: "asc" }
        },
        values: {
          include: { value: true },
          orderBy: { order: "asc" }
        }
      }
    });

    // Calculate profile completion percentage
    const completion = await this.profileCompletion.calculateCompletion(userId);

    return { user, profileCompletion: completion };
  }

  /**
   * Add photo for user by ID (test endpoint, bypasses auth)
   */
  async addPhotoForUser(userId: string, data: CreatePhotoDto) {
    // Check current photo count
    const photoCount = await this.prisma.userPhoto.count({
      where: { userId }
    });

    if (photoCount >= 3) {
      throw new HttpException("Maximum 3 photos allowed", HttpStatus.BAD_REQUEST);
    }

    // Validate photo URL for NSFW content
    await this.moderationClient.checkImage(data.url);

    // Check if order is already taken
    const existingPhoto = await this.prisma.userPhoto.findFirst({
      where: { userId, order: data.order }
    });

    if (existingPhoto) {
      throw new HttpException(`Photo with order ${data.order} already exists`, HttpStatus.CONFLICT);
    }

    const photo = await this.prisma.userPhoto.create({
      data: {
        userId,
        url: data.url,
        order: data.order
      }
    });

    return { photo };
  }

  /**
   * Delete photo for user by ID (test endpoint, bypasses auth)
   */
  async deletePhotoForUser(userId: string, photoId: string) {
    const photo = await this.prisma.userPhoto.findFirst({
      where: { id: photoId, userId }
    });

    if (!photo) {
      throw new HttpException("Photo not found", HttpStatus.NOT_FOUND);
    }

    await this.prisma.userPhoto.delete({
      where: { id: photoId }
    });

    return { ok: true };
  }

  /**
   * Update music preference for user by ID (test endpoint, bypasses auth)
   */
  async updateMusicPreferenceForUser(userId: string, musicPreferenceId: string) {
    // Verify song exists
    const song = await this.prisma.song.findUnique({
      where: { id: musicPreferenceId }
    });

    if (!song) {
      throw new HttpException("Music preference not found", HttpStatus.NOT_FOUND);
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { musicPreferenceId },
      include: { musicPreference: true }
    });

    return { user };
  }

  /**
   * Update brand preferences for user by ID (test endpoint, bypasses auth)
   */
  async updateBrandPreferencesForUser(userId: string, data: UpdateBrandPreferencesDto) {
    if (data.brandIds.length > 5) {
      throw new HttpException("Maximum 5 brands allowed", HttpStatus.BAD_REQUEST);
    }

    // Verify all brands exist
    const brands = await this.prisma.brand.findMany({
      where: { id: { in: data.brandIds } }
    });

    if (brands.length !== data.brandIds.length) {
      throw new HttpException("One or more brands not found", HttpStatus.NOT_FOUND);
    }

    // Delete existing preferences
    await this.prisma.userBrand.deleteMany({
      where: { userId }
    });

    // Create new preferences
    await this.prisma.userBrand.createMany({
      data: data.brandIds.map((brandId, index) => ({
        userId,
        brandId,
        order: index
      }))
    });

    const preferences = await this.prisma.userBrand.findMany({
      where: { userId },
      include: { brand: true },
      orderBy: { order: "asc" }
    });

    return { preferences };
  }

  /**
   * Update interests for user by ID (test endpoint, bypasses auth)
   */
  async updateInterestsForUser(userId: string, data: UpdateInterestsDto) {
    if (data.interestIds.length > 4) {
      throw new HttpException("Maximum 4 interests allowed", HttpStatus.BAD_REQUEST);
    }

    // Verify all interests exist
    const interests = await this.prisma.interest.findMany({
      where: { id: { in: data.interestIds } }
    });

    if (interests.length !== data.interestIds.length) {
      throw new HttpException("One or more interests not found", HttpStatus.NOT_FOUND);
    }

    // Delete existing preferences
    await this.prisma.userInterest.deleteMany({
      where: { userId }
    });

    // Create new preferences
    await this.prisma.userInterest.createMany({
      data: data.interestIds.map((interestId, index) => ({
        userId,
        interestId,
        order: index
      }))
    });

    const userInterests = await this.prisma.userInterest.findMany({
      where: { userId },
      include: { interest: true },
      orderBy: { order: "asc" }
    });

    return { interests: userInterests };
  }

  /**
   * Update values for user by ID (test endpoint, bypasses auth)
   */
  async updateValuesForUser(userId: string, data: UpdateValuesDto) {
    if (data.valueIds.length > 4) {
      throw new HttpException("Maximum 4 values allowed", HttpStatus.BAD_REQUEST);
    }

    // Verify all values exist
    const values = await this.prisma.value.findMany({
      where: { id: { in: data.valueIds } }
    });

    if (values.length !== data.valueIds.length) {
      throw new HttpException("One or more values not found", HttpStatus.NOT_FOUND);
    }

    // Delete existing preferences
    await this.prisma.userValue.deleteMany({
      where: { userId }
    });

    // Create new preferences
    await this.prisma.userValue.createMany({
      data: data.valueIds.map((valueId, index) => ({
        userId,
        valueId,
        order: index
      }))
    });

    const userValues = await this.prisma.userValue.findMany({
      where: { userId },
      include: { value: true },
      orderBy: { order: "asc" }
    });

    return { values: userValues };
  }

  /**
   * Update location for user by ID (test endpoint, bypasses auth)
   */
  async updateLocationForUser(userId: string, data: UpdateLocationDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      // @ts-ignore - Workspace Prisma client type resolution issue
      data: {
        latitude: data.latitude,
        longitude: data.longitude,
        locationUpdatedAt: new Date()
      }
    });

    return { user };
  }

  /**
   * Update preferred city for user by ID (test endpoint, bypasses auth)
   */
  async updatePreferredCityForUser(userId: string, data: UpdatePreferredCityDto) {
    // Check if user exists
    const existingUser = await this.prisma.user.findUnique({
      where: { id: userId }
    });

    if (!existingUser) {
      throw new HttpException("User profile not found", HttpStatus.NOT_FOUND);
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        preferredCity: data.city
      } as any
    });

    return { city: (user as any).preferredCity || null };
  }

  /**
   * Export all user data (GDPR compliance)
   * Returns all user data in a structured format
   */
  async exportUserData(userId: string): Promise<any> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        photos: { orderBy: { order: "asc" } },
        musicPreference: true,
        brandPreferences: { include: { brand: true } },
        interests: { include: { interest: true } },
        values: { include: { value: true } }
      }
    });

    if (!user) {
      throw new HttpException("User not found", HttpStatus.NOT_FOUND);
    }

    // Get profile completion
    const profileCompletion = await this.profileCompletion.getProfileCompletion(userId);

    return {
      userId: user.id,
      exportedAt: new Date().toISOString(),
      profile: {
        username: user.username,
        dateOfBirth: user.dateOfBirth,
        gender: user.gender,
        displayPictureUrl: user.displayPictureUrl,
        intent: user.intent,
        status: user.status,
        latitude: user.latitude,
        longitude: user.longitude,
        preferredCity: (user as any).preferredCity,
        videoEnabled: (user as any).videoEnabled,
        profileCompleted: user.profileCompleted,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      },
      photos: user.photos.map(photo => ({
        id: photo.id,
        url: photo.url,
        order: photo.order,
        createdAt: photo.createdAt
      })),
      musicPreference: user.musicPreference ? {
        name: user.musicPreference.name,
        artist: user.musicPreference.artist,
        albumArtUrl: user.musicPreference.albumArtUrl
      } : null,
      brandPreferences: user.brandPreferences.map(bp => ({
        brand: {
          name: bp.brand.name,
          logoUrl: bp.brand.logoUrl
        }
      })),
      interests: user.interests.map(interest => ({
        name: interest.interest.name,
        genre: interest.interest.genre
      })),
      values: user.values.map(value => ({
        name: value.value.name
      })),
      profileCompletion
    };
  }

  /**
   * Delete user account and all associated data
   * This is called when account deletion is confirmed
   * Note: This should be called after auth-service marks account as deleted
   */
  async deleteUserAccount(userId: string): Promise<void> {
    // Delete all user data
    await this.prisma.user.delete({
      where: { id: userId }
    });

    // Note: Related data (photos, preferences, etc.) will be cascade deleted
    // Additional cleanup may be needed for:
    // - Files in Cloudflare R2 (via files-service)
    // - Wallet data (via wallet-service)
    // - Friend relationships (via friend-service)
    // - Streaming sessions (via streaming-service)
    // - Discovery matches (via discovery-service)
  }

  /**
   * Update status for user by ID (test endpoint, bypasses auth)
   */
  async updateStatusForUser(userId: string, data: UpdateStatusDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      // @ts-ignore - Workspace Prisma client type resolution issue
      data: {
        status: data.status as UserStatus
      }
    });

    return { user };
  }
}

