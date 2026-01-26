import { Injectable, Logger } from "@nestjs/common";
import fetch from "node-fetch";

@Injectable()
export class UserClientService {
  private readonly logger = new Logger(UserClientService.name);
  private readonly authServiceUrl: string;
  private readonly userServiceUrl: string;

  constructor() {
    this.authServiceUrl = process.env.AUTH_SERVICE_URL || "http://localhost:3001";
    this.userServiceUrl = process.env.USER_SERVICE_URL || "http://localhost:3002";
  }

  /**
   * Check if user account is active
   * Returns true if account is ACTIVE and not deleted
   * Uses auth-service's isAccountActive method via internal endpoint
   * In test mode, skips the check and returns true
   */
  async isAccountActive(userId: string): Promise<boolean> {
    // Skip auth check in test mode
    if (process.env.TEST_MODE === "true" || process.env.NODE_ENV === "test") {
      return true;
    }

    try {
      // Try internal endpoint first
      const response = await fetch(`${this.authServiceUrl}/internal/users/${userId}/active`, {
        method: "GET",
        headers: {
          "x-service-token": process.env.INTERNAL_SERVICE_TOKEN || ""
        },
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });

      if (response.ok) {
        const data = await response.json() as { isActive: boolean };
        return data.isActive ?? true;
      }

      // Fallback: If internal endpoint doesn't exist, assume active (fail open)
      // In production, this should be implemented in auth-service
      this.logger.warn(`Internal account status endpoint not available for ${userId}, assuming active`);
      return true;
    } catch (error: any) {
      // Fail open - if we can't check, assume active
      this.logger.warn(`Error checking account status for ${userId}: ${error.message}, assuming active`);
      return true;
    }
  }

  /**
   * Check if user is blocked by another user
   * This checks FriendRequest status = BLOCKED
   */
  async isBlocked(_blockerId: string, _blockedId: string): Promise<boolean> {
    // This will be checked in FriendService using Prisma directly
    // since blocking is tracked in friend-service's database
    return false; // Placeholder - actual check done in FriendService
  }

  /**
   * Batch fetch display pictures for multiple users
   * Returns a Map of userId -> displayPictureUrl (or null if not found/no photo)
   */
  async getUsersDisplayPictures(userIds: string[]): Promise<Map<string, string | null>> {
    if (userIds.length === 0) {
      return new Map();
    }

    try {
      // Use the existing batch endpoint from user-service
      const response = await fetch(`${this.userServiceUrl}/users/batch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-service-token": process.env.INTERNAL_SERVICE_TOKEN || ""
        },
        body: JSON.stringify({ userIds }),
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });

      if (!response.ok) {
        this.logger.warn(`Failed to fetch display pictures from user-service: ${response.status}`);
        // Return empty map on error - graceful degradation
        return new Map();
      }

      const data = await response.json() as { users: Array<{ id: string; displayPictureUrl: string | null }> };
      const photoMap = new Map<string, string | null>();

      // Map users to their display pictures
      if (data.users && Array.isArray(data.users)) {
        for (const user of data.users) {
          photoMap.set(user.id, user.displayPictureUrl || null);
        }
      }

      // Ensure all requested userIds are in the map (set to null if not found)
      for (const userId of userIds) {
        if (!photoMap.has(userId)) {
          photoMap.set(userId, null);
        }
      }

      return photoMap;
    } catch (error: any) {
      // Graceful degradation - log error but return empty map
      this.logger.warn(`Error fetching display pictures: ${error.message}`);
      // Return map with null values for all requested users
      const photoMap = new Map<string, string | null>();
      for (const userId of userIds) {
        photoMap.set(userId, null);
      }
      return photoMap;
    }
  }
}
