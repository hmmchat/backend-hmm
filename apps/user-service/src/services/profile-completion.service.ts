// @ts-nocheck - Workspace Prisma client type resolution issues
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

interface ProfileCompletionResult {
  percentage: number;
  completed: number;
  total: number;
  details: {
    required: {
      username: boolean;
      dateOfBirth: boolean;
      gender: boolean;
      displayPictureUrl: boolean;
    };
    optional: {
      photos: { filled: number; max: number };
      musicPreference: boolean;
      brandPreferences: { filled: number; max: number };
      interests: { filled: number; max: number };
      values: { filled: number; max: number };
      intent: boolean;
    };
  };
}

@Injectable()
export class ProfileCompletionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calculate profile completion percentage
   * 
   * Scoring:
   * - Required fields (username, DOB, gender, displayPicture): 50% total (12.5% each)
   * - Optional fields: 50% total
   *   - Photos (0-3): 8% total
   *   - Music: 7%
   *   - Brands (0-5): 10% (2% per brand)
   *   - Interests (optional, non-incremental): 10% if at least 1 selected
   *   - Values (optional, non-incremental): 10% if at least 1 selected
   *   - Intent: 3%
   *   - Unallocated bonus: 2% (always granted)
   */
  async calculateCompletion(userId: string): Promise<ProfileCompletionResult> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        photos: true,
        musicPreference: true,
        brandPreferences: true,
        interests: true,
        values: true
      }
    });

    if (!user) {
      throw new Error("User not found");
    }

    const details: ProfileCompletionResult["details"] = {
      required: {
        username: !!user.username,
        dateOfBirth: !!user.dateOfBirth,
        gender: !!user.gender,
        displayPictureUrl: !!user.displayPictureUrl
      },
      optional: {
        photos: {
          filled: user.photos.length,
          max: 3
        },
        musicPreference: !!user.musicPreferenceId,
        brandPreferences: {
          filled: user.brandPreferences.length,
          max: 5
        },
        interests: {
          filled: user.interests.length,
          max: 1
        },
        values: {
          filled: user.values.length,
          max: 1
        },
        intent: !!user.intent
      }
    };

    // Calculate percentage
    let percentage = 0;
    let completed = 0;
    let total = 0;

    // Required fields: 50% total (12.5% each = 4 fields)
    const requiredFields = [
      details.required.username,
      details.required.dateOfBirth,
      details.required.gender,
      details.required.displayPictureUrl
    ];
    const requiredCompleted = requiredFields.filter(Boolean).length;
    percentage += (requiredCompleted / 4) * 50;
    completed += requiredCompleted;
    total += 4;

    // Optional fields: 50% total
    // Photos: 8% total (max 3)
    const photosPercentage = Math.min(details.optional.photos.filled / 3, 1) * 8;
    percentage += photosPercentage;
    completed += details.optional.photos.filled;
    total += 3;

    // Music: 7%
    if (details.optional.musicPreference) {
      percentage += 7;
      completed += 1;
    }
    total += 1;

    // Brands: 10% (2% per brand, max 5)
    const brandsPercentage = Math.min(details.optional.brandPreferences.filled / 5, 1) * 10;
    percentage += brandsPercentage;
    completed += details.optional.brandPreferences.filled;
    total += 5;

    // Interests: optional bucket, full 10% if at least 1 selected
    const interestsPercentage = details.optional.interests.filled >= 1 ? 10 : 0;
    percentage += interestsPercentage;
    completed += Math.min(details.optional.interests.filled, 1);
    total += 1;

    // Values: optional bucket, full 10% if at least 1 selected
    const valuesPercentage = details.optional.values.filled >= 1 ? 10 : 0;
    percentage += valuesPercentage;
    completed += Math.min(details.optional.values.filled, 1);
    total += 1;

    // Intent: 3%
    if (details.optional.intent) {
      percentage += 3;
      completed += 1;
    }
    total += 1;

    // Grant remaining 2% so users can reach 100% without location.
    percentage += 2;

    // VideoEnabled: Already counted in total but doesn't add to percentage
    // (it's a preference with default value)

    // Round to 2 decimal places
    percentage = Math.round(percentage * 100) / 100;

    return {
      percentage,
      completed,
      total,
      details
    };
  }
}

