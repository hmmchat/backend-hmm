import { Injectable, HttpException, HttpStatus, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { ProfileCompletionService } from "./profile-completion.service.js";
import { ModerationClientService } from "./moderation-client.service.js";
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
  UpdateStatusDto,
  CreateMusicPreferenceDto
} from "../dtos/profile.dto.js";
import { Gender, UserStatus } from "@prisma/client";

@Injectable()
export class UserService implements OnModuleInit {
  private verifyAccess!: (token: string) => Promise<AccessPayload>;
  private publicJwk!: JWK;

  constructor(
    private readonly prisma: PrismaService,
    private readonly profileCompletion: ProfileCompletionService,
    private readonly moderationClient: ModerationClientService
  ) {}

  async onModuleInit() {
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
      const payload = await this.verifyAccess(accessToken);
      return payload.sub; // user id
    } catch (error) {
      throw new HttpException("Invalid or expired token", HttpStatus.UNAUTHORIZED);
    }
  }

  /* ---------- Profile Management ---------- */

  async createProfile(userId: string, data: CreateProfileDto) {
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
    await this.moderationClient.checkImage(data.displayPictureUrl);

    // Create user profile
    const user = await this.prisma.user.create({
      data: {
        id: userId, // Use the same ID from auth-service
        username: data.username,
        dateOfBirth: data.dateOfBirth,
        gender: data.gender as Gender,
        displayPictureUrl: data.displayPictureUrl,
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

    return { user, profileCompletion: completion };
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
              photos: { filled: user.photos.length, max: 4 },
              musicPreference: !!user.musicPreferenceId,
              brandPreferences: { filled: user.brandPreferences.length, max: 5 },
              interests: { filled: user.interests.length, max: 4 },
              values: { filled: user.values.length, max: 4 },
              intent: !!user.intent,
              location: !!(user.latitude && user.longitude)
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
      reported: "reported",
      badgeMember: "badgeMember",
      createdAt: "createdAt",
      updatedAt: "updatedAt",
      locationUpdatedAt: "locationUpdatedAt",
      // Relation fields
      photos: "photos",
      musicPreference: "musicPreference",
      brandPreferences: "brandPreferences",
      interests: "interests",
      values: "values"
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

    // Check current photo count
    const photoCount = await this.prisma.userPhoto.count({
      where: { userId }
    });

    if (photoCount >= 4) {
      throw new HttpException("Maximum 4 photos allowed", HttpStatus.BAD_REQUEST);
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

  async getBrands() {
    const brands = await this.prisma.brand.findMany({
      orderBy: { name: "asc" }
    });
    return { brands };
  }

  async getInterests() {
    const interests = await this.prisma.interest.findMany({
      orderBy: { name: "asc" }
    });
    return { interests };
  }

  async getValues() {
    const values = await this.prisma.value.findMany({
      orderBy: { name: "asc" }
    });
    return { values };
  }

  /* ---------- Location ---------- */

  async updateLocation(accessToken: string, data: UpdateLocationDto) {
    const userId = await this.verifyAccessToken(accessToken);

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        latitude: data.latitude,
        longitude: data.longitude,
        locationUpdatedAt: new Date()
      }
    });

    return { user };
  }

  /* ---------- Status ---------- */

  async updateStatus(accessToken: string, data: UpdateStatusDto) {
    const userId = await this.verifyAccessToken(accessToken);

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        status: data.status as UserStatus
      } as any // Type assertion needed due to Prisma type generation issue
    });

    return { user };
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

    return { users };
  }

  async getProfileCompletion(userId: string) {
    const completion = await this.profileCompletion.calculateCompletion(userId);
    return { profileCompletion: completion };
  }

  async getUsersNearby(latitude: number, longitude: number, radiusKm: number = 10, limit: number = 50) {
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
      WHERE distance_km <= ${radiusKm}
      ORDER BY distance_km ASC
      LIMIT ${limit}
    `;

    return { users };
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
      }
    });
    return count;
  }
}

