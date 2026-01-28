import { Injectable, Logger } from "@nestjs/common";
import fetch from "node-fetch";

@Injectable()
export class AuthClientService {
  private readonly logger = new Logger(AuthClientService.name);
  private readonly authServiceUrl: string;

  constructor() {
    this.authServiceUrl = process.env.AUTH_SERVICE_URL || "http://localhost:3001";
  }

  /**
   * Get referral status for a user
   * Returns null if user has no referral or if service is unavailable
   */
  async getReferralStatus(userId: string): Promise<{
    referredBy: string | null;
    referralRewardClaimed: boolean;
    referralCode: string;
  } | null> {
    try {
      const response = await fetch(`${this.authServiceUrl}/auth/users/${userId}/referral-status`, {
        method: "GET",
        headers: { "Content-Type": "application/json" }
      });

      if (!response.ok) {
        if (response.status === 404) {
          // User not found - return null
          return null;
        }
        const errorText = await response.text().catch(() => "Unknown error");
        throw new Error(`Failed to get referral status: ${errorText}`);
      }

      return await response.json() as {
        referredBy: string | null;
        referralRewardClaimed: boolean;
        referralCode: string;
      };
    } catch (error: any) {
      // Log error but don't throw - allow profile creation to proceed
      this.logger.warn(`Error getting referral status for ${userId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Mark referral reward as claimed
   * Returns true if successful, false otherwise (doesn't throw)
   */
  async markReferralClaimed(userId: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.authServiceUrl}/auth/users/${userId}/mark-referral-claimed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        throw new Error(`Failed to mark referral as claimed: ${errorText}`);
      }

      return true;
    } catch (error: any) {
      // Log error but don't throw - this is not critical
      this.logger.warn(`Error marking referral as claimed for ${userId}: ${error.message}`);
      return false;
    }
  }

  /**
   * Check if a user account is active
   * Returns true if active, false otherwise
   */
  async isAccountActive(userId: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.authServiceUrl}/auth/users/${userId}/account-status`, {
        method: "GET",
        headers: { "Content-Type": "application/json" }
      });

      if (!response.ok) {
        // If endpoint doesn't exist or user not found, assume inactive for safety
        return false;
      }

      const data = await response.json() as { status: string; deletedAt: Date | null };
      return data.status === "ACTIVE" && !data.deletedAt;
    } catch (error: any) {
      // Log error and assume inactive for safety
      this.logger.warn(`Error checking account status for ${userId}: ${error.message}`);
      return false;
    }
  }
}
