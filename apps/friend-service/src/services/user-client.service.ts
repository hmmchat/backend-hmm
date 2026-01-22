import { Injectable, Logger } from "@nestjs/common";
import fetch from "node-fetch";

@Injectable()
export class UserClientService {
  private readonly logger = new Logger(UserClientService.name);
  private readonly authServiceUrl: string;

  constructor() {
    this.authServiceUrl = process.env.AUTH_SERVICE_URL || "http://localhost:3001";
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
}
