import { Injectable, Logger } from "@nestjs/common";
import fetch from "node-fetch";

@Injectable()
export class DiscoveryClientService {
  private readonly logger = new Logger(DiscoveryClientService.name);
  private readonly userServiceUrl: string;
  private readonly discoveryServiceUrl: string;
  /** HTTP timeout for user-service calls (status checks must not hang indefinitely) */
  private readonly userServiceRequestTimeoutMs: number;

  constructor() {
    this.userServiceUrl = process.env.USER_SERVICE_URL || "http://localhost:3002";
    this.discoveryServiceUrl = process.env.DISCOVERY_SERVICE_URL || "http://localhost:3004";
    this.userServiceRequestTimeoutMs = parseInt(process.env.USER_SERVICE_TIMEOUT_MS || "15000", 10);
  }

  /**
   * Notify discovery-service that users have entered IN_SQUAD (room created)
   */
  async notifyRoomCreated(roomId: string, userIds: string[]): Promise<void> {
    try {
      this.logger.log(`Room ${roomId} created with users: ${userIds.join(", ")} - notifying discovery-service`);
      
      const response = await fetch(`${this.discoveryServiceUrl}/discovery/internal/room-created`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, userIds }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.warn(`Discovery-service returned ${response.status} for room-created: ${errorText}`);
        // Don't throw - room creation should succeed even if discovery-service is unavailable
        return;
      }

      const result = await response.json() as { success: boolean; message?: string };
      this.logger.log(`Successfully notified discovery-service: ${result.message || "Room created"}`);
    } catch (error: any) {
      this.logger.error(`Error notifying discovery-service of room creation: ${error.message}`);
      // Don't throw - room creation should succeed even if discovery-service is unavailable
    }
  }

  /**
   * Notify discovery-service that broadcasting has started (IN_BROADCAST)
   */
  async notifyBroadcastStarted(roomId: string, userIds: string[]): Promise<void> {
    try {
      this.logger.log(`Broadcast started for room ${roomId} with users: ${userIds.join(", ")} - notifying discovery-service`);
      
      const response = await fetch(`${this.discoveryServiceUrl}/discovery/internal/broadcast-started`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, userIds }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.warn(`Discovery-service returned ${response.status} for broadcast-started: ${errorText}`);
        // Don't throw - broadcast should succeed even if discovery-service is unavailable
        return;
      }

      const result = await response.json() as { success: boolean; message?: string };
      this.logger.log(`Successfully notified discovery-service: ${result.message || "Broadcast started"}`);
    } catch (error: any) {
      this.logger.error(`Error notifying discovery-service of broadcast start: ${error.message}`);
      // Don't throw - broadcast should succeed even if discovery-service is unavailable
    }
  }

  /**
   * Notify discovery-service that call has ended (update to AVAILABLE)
   */
  async notifyCallEnded(roomId: string, userIds: string[]): Promise<void> {
    try {
      this.logger.log(`Call ended for room ${roomId}, updating users to AVAILABLE: ${userIds.join(", ")} - notifying discovery-service`);
      
      const response = await fetch(`${this.discoveryServiceUrl}/discovery/internal/call-ended`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, userIds }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.warn(`Discovery-service returned ${response.status} for call-ended: ${errorText}`);
        // Don't throw - call ending should succeed even if discovery-service is unavailable
        return;
      }

      const result = await response.json() as { success: boolean; message?: string };
      this.logger.log(`Successfully notified discovery-service: ${result.message || "Call ended"}`);
    } catch (error: any) {
      this.logger.error(`Error notifying discovery-service of call end: ${error.message}`);
      // Don't throw - call ending should succeed even if discovery-service is unavailable
    }
  }

  /**
   * Notify discovery-service that a participant joined (3rd/4th person)
   */
  async notifyParticipantJoined(roomId: string, userId: string): Promise<void> {
    try {
      this.logger.log(`Participant ${userId} joined room ${roomId}`);
      
      // TODO: Call discovery-service API if needed
    } catch (error: any) {
      this.logger.error(`Error notifying discovery-service of participant join: ${error.message}`);
    }
  }

  /**
   * Update user status (single user)
   */
  async updateUserStatus(userId: string, status: string): Promise<void> {
    try {
      const response = await fetch(`${this.userServiceUrl}/users/test/${userId}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status }),
        signal: AbortSignal.timeout(this.userServiceRequestTimeoutMs)
      } as any);

      if (!response.ok) {
        const error = await response.text();
        this.logger.warn(`Failed to update user status (user-service may not be available): ${error}`);
        // In test mode or when user-service is unavailable, don't throw - just log
        if (process.env.TEST_MODE !== "true") {
          throw new Error(`Failed to update user ${userId} status to ${status}`);
        }
        return;
      }

      this.logger.log(`User ${userId} status updated to ${status}`);
    } catch (error: any) {
      this.logger.warn(`Error updating user status (user-service may not be available): ${error.message}`);
      // In test mode, don't throw - just log the warning
      if (process.env.TEST_MODE !== "true") {
        throw error;
      }
    }
  }

  /**
   * Update user statuses (multiple users)
   */
  async updateUserStatuses(userIds: string[], status: string): Promise<void> {
    try {
      // Update all users in parallel (errors are handled in updateUserStatus)
      await Promise.all(
        userIds.map((userId) => this.updateUserStatus(userId, status))
      );
      this.logger.log(`Updated ${userIds.length} users to status ${status}`);
    } catch (error: any) {
      this.logger.warn(`Error updating user statuses (user-service may not be available): ${error.message}`);
      // In test mode, don't throw - just log the warning
      if (process.env.TEST_MODE !== "true") {
        throw error;
      }
    }
  }

  /**
   * Get user status from user-service
   * Required to validate that users are MATCHED before creating/joining rooms
   * Uses test endpoint: GET /users/test/:userId?fields=status
   */
  async getUserStatus(userId: string): Promise<string> {
    try {
      // Use test endpoint that doesn't require auth (works in TEST_MODE)
      const response = await fetch(`${this.userServiceUrl}/users/test/${userId}?fields=status`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(this.userServiceRequestTimeoutMs)
      } as any);

      if (!response.ok) {
        const error = await response.text();
        this.logger.warn(`Failed to get user status (user-service may not be available): ${error}`);
        // In test mode, return a default status to allow testing
        if (process.env.TEST_MODE === "true") {
          this.logger.log(`[TEST_MODE] User-service unavailable, assuming user ${userId} is MATCHED`);
          return "MATCHED"; // Assume MATCHED in test mode
        }
        throw new Error(`Failed to get user ${userId} status: ${error}`);
      }

      const data = await response.json() as { user?: { status?: string } };
      const status = data?.user?.status || "AVAILABLE";
      
      this.logger.debug(`User ${userId} status: ${status}`);
      return status;
    } catch (error: any) {
      this.logger.warn(`Error getting user status (user-service may not be available): ${error.message}`);
      // In test mode, return a default status to allow testing
      if (process.env.TEST_MODE === "true") {
        this.logger.log(`[TEST_MODE] Error checking status, assuming user ${userId} is MATCHED`);
        return "MATCHED";
      }
      throw error;
    }
  }

  /**
   * Report a user (forwards to user-service with optional reportType for configurable weight)
   */
  async reportUser(
    token: string,
    reportedUserId: string,
    reportType?: string
  ): Promise<{ reportCount: number }> {
    try {
      const body: { reportedUserId: string; reportType?: string } = { reportedUserId };
      if (reportType !== undefined && reportType !== "") {
        body.reportType = reportType;
      }
      const response = await fetch(`${this.userServiceUrl}/users/report`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const error = await response.text();
        this.logger.warn(`Failed to report user (user-service may not be available): ${error}`);
        throw new Error(`Failed to report user ${reportedUserId}`);
      }

      const result = await response.json() as { success: boolean; reportCount: number };
      return { reportCount: result.reportCount };
    } catch (error: any) {
      this.logger.error(`Error reporting user: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get user profile by userId (for enriching broadcast participant info, history)
   */
  async getUserProfile(userId: string): Promise<{
    username: string | null;
    displayPictureUrl: string | null;
    age: number | null;
    preferredCity: string | null;
  }> {
    try {
      const response = await fetch(
        `${this.userServiceUrl}/users/test/${userId}?fields=username,displayPictureUrl,dateOfBirth,preferredCity`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" }
        }
      );

      if (!response.ok) {
        this.logger.warn(`Failed to get user profile for ${userId}: ${response.status}`);
        return { username: null, displayPictureUrl: null, age: null, preferredCity: null };
      }

      const data = (await response.json()) as {
        user?: {
          username?: string | null;
          displayPictureUrl?: string | null;
          dateOfBirth?: string | null;
          preferredCity?: string | null;
        };
      };
      const user = data.user || {};

      // Calculate age from dateOfBirth
      let age: number | null = null;
      if (user.dateOfBirth) {
        const birthDate = new Date(user.dateOfBirth);
        const today = new Date();
        age = today.getFullYear() - birthDate.getFullYear();
        const monthDiff = today.getMonth() - birthDate.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
          age--;
        }
      }

      return {
        username: user.username || null,
        displayPictureUrl: user.displayPictureUrl || null,
        age,
        preferredCity: user.preferredCity ?? null
      };
    } catch (error: any) {
      this.logger.error(`Error getting user profile for ${userId}: ${error.message}`);
      return { username: null, displayPictureUrl: null, age: null, preferredCity: null };
    }
  }

  /**
   * Get user profiles in batch (for enriching broadcast participant info, history)
   */
  async getUserProfilesBatch(userIds: string[]): Promise<
    Map<
      string,
      {
        username: string | null;
        displayPictureUrl: string | null;
        age: number | null;
        preferredCity: string | null;
      }
    >
  > {
    const profiles = new Map<
      string,
      {
        username: string | null;
        displayPictureUrl: string | null;
        age: number | null;
        preferredCity: string | null;
      }
    >();

    if (userIds.length === 0) {
      return profiles;
    }

    const profilePromises = userIds.map(async (userId) => {
      try {
        const profile = await this.getUserProfile(userId);
        return { userId, profile };
      } catch (error: any) {
        this.logger.warn(`Failed to fetch profile for user ${userId}: ${error.message}`);
        return {
          userId,
          profile: {
            username: null,
            displayPictureUrl: null,
            age: null,
            preferredCity: null
          }
        };
      }
    });

    const results = await Promise.all(profilePromises);
    results.forEach(({ userId, profile }) => {
      profiles.set(userId, profile);
    });

    return profiles;
  }
}
