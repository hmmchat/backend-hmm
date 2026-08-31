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

  /**
   * Among the given userIds, return those whose display name (username) contains query.
   * POST /users/internal/match-usernames
   */
  async matchUsernamesAmongIds(
    userIds: string[],
    query: string
  ): Promise<Array<{ id: string; username: string | null; displayPictureUrl: string | null }>> {
    const unique = [...new Set(userIds.filter(Boolean))];
    const q = (query || "").trim();
    if (unique.length === 0 || q.length < 1) {
      return [];
    }

    try {
      const response = await fetch(`${this.userServiceUrl}/users/internal/match-usernames`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-service-token": process.env.INTERNAL_SERVICE_TOKEN || ""
        },
        body: JSON.stringify({ userIds: unique, query: q }),
        signal: AbortSignal.timeout(8000)
      });

      if (!response.ok) {
        this.logger.warn(`match-usernames failed: ${response.status}`);
        return [];
      }

      const data = (await response.json()) as {
        users?: Array<{ id: string; username: string | null; displayPictureUrl: string | null }>;
      };
      return Array.isArray(data.users) ? data.users : [];
    } catch (error: any) {
      this.logger.warn(`Error matching usernames: ${error.message}`);
      return [];
    }
  }

  /**
   * Get user profile (username and display picture)
   * Returns username and displayPictureUrl for a single user
   */
  async getUserProfile(userId: string): Promise<{ username: string | null; displayPictureUrl: string | null }> {
    try {
      // Use the existing user endpoint with fields filter
      const response = await fetch(`${this.userServiceUrl}/users/${userId}?fields=username,displayPictureUrl`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "x-service-token": process.env.INTERNAL_SERVICE_TOKEN || ""
        },
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });

      if (!response.ok) {
        this.logger.warn(`Failed to fetch user profile from user-service: ${response.status}`);
        // Return null values on error - graceful degradation
        return { username: null, displayPictureUrl: null };
      }

      const data = await response.json() as { user: { username: string | null; displayPictureUrl: string | null } };
      
      if (data.user) {
        return {
          username: data.user.username || null,
          displayPictureUrl: data.user.displayPictureUrl || null
        };
      }

      return { username: null, displayPictureUrl: null };
    } catch (error: any) {
      // Graceful degradation - log error but return null values
      this.logger.warn(`Error fetching user profile for ${userId}: ${error.message}`);
      return { username: null, displayPictureUrl: null };
    }
  }

  /**
   * Fetch user account createdAt for BEAM campaign eligibility.
   */
  async getUserCreatedAt(userId: string): Promise<Date | null> {
    try {
      const response = await fetch(
        `${this.userServiceUrl}/users/internal/${encodeURIComponent(userId)}/created-at`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "x-service-token": process.env.INTERNAL_SERVICE_TOKEN || ""
          },
          signal: AbortSignal.timeout(5000)
        }
      );

      if (!response.ok) {
        this.logger.warn(`Failed to fetch createdAt for ${userId}: ${response.status}`);
        return null;
      }

      const data = (await response.json()) as { createdAt?: string | null };
      if (!data.createdAt) return null;
      const d = new Date(data.createdAt);
      return Number.isNaN(d.getTime()) ? null : d;
    } catch (error: any) {
      this.logger.warn(`Error fetching createdAt for ${userId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Validate which userIds exist (for BEAM MOD targeting).
   */
  async validateUserIds(userIds: string[]): Promise<{ validIds: string[]; invalidIds: string[] }> {
    const unique = [...new Set(userIds.filter(Boolean))];
    if (unique.length === 0) {
      return { validIds: [], invalidIds: [] };
    }

    try {
      const response = await fetch(`${this.userServiceUrl}/users/internal/validate-ids`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-service-token": process.env.INTERNAL_SERVICE_TOKEN || ""
        },
        body: JSON.stringify({ userIds: unique }),
        signal: AbortSignal.timeout(15000)
      });

      if (!response.ok) {
        this.logger.warn(`validate-ids failed: ${response.status}; treating all as valid (fail-open)`);
        return { validIds: unique, invalidIds: [] };
      }

      const data = (await response.json()) as {
        validIds?: string[];
        invalidIds?: string[];
      };
      return {
        validIds: Array.isArray(data.validIds) ? data.validIds : unique,
        invalidIds: Array.isArray(data.invalidIds) ? data.invalidIds : []
      };
    } catch (error: any) {
      this.logger.warn(`Error validating userIds: ${error.message}; treating all as valid`);
      return { validIds: unique, invalidIds: [] };
    }
  }

  /**
   * Batch effective presence statuses from user-service (respects heartbeat staleness).
   */
  async getEffectiveStatuses(userIds: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (userIds.length === 0) {
      return result;
    }

    const uniqueIds = [...new Set(userIds)];

    try {
      const response = await fetch(`${this.userServiceUrl}/users/internal/status/batch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-service-token": process.env.INTERNAL_SERVICE_TOKEN || ""
        },
        body: JSON.stringify({ userIds: uniqueIds }),
        signal: AbortSignal.timeout(5000)
      });

      if (!response.ok) {
        this.logger.warn(`Failed to fetch user statuses from user-service: ${response.status}`);
        for (const userId of uniqueIds) {
          result.set(userId, "OFFLINE");
        }
        return result;
      }

      const data = (await response.json()) as {
        statuses?: Record<string, { status?: string }>;
      };

      for (const userId of uniqueIds) {
        const status = data.statuses?.[userId]?.status;
        result.set(userId, status || "OFFLINE");
      }

      return result;
    } catch (error: any) {
      this.logger.warn(`Error fetching user statuses: ${error.message}`);
      for (const userId of uniqueIds) {
        result.set(userId, "OFFLINE");
      }
      return result;
    }
  }
}
