import { Injectable, Logger } from "@nestjs/common";
import fetch from "node-fetch";

@Injectable()
export class DiscoveryClientService {
  private readonly logger = new Logger(DiscoveryClientService.name);
  private readonly userServiceUrl: string;

  constructor() {
    this.userServiceUrl = process.env.USER_SERVICE_URL || "http://localhost:3002";
  }

  /**
   * Notify discovery-service that users have entered IN_SQUAD (room created)
   */
  async notifyRoomCreated(roomId: string, userIds: string[]): Promise<void> {
    try {
      // In a real implementation, this would call discovery-service to update user statuses
      // For now, we'll just log it
      this.logger.log(`Room ${roomId} created with users: ${userIds.join(", ")}`);
      
      // TODO: Call discovery-service API to update user statuses to IN_SQUAD
      // await fetch(`${this.discoveryServiceUrl}/discovery/room-created`, {
      //   method: "POST",
      //   headers: { "Content-Type": "application/json" },
      //   body: JSON.stringify({ roomId, userIds }),
      // });
    } catch (error: any) {
      this.logger.error(`Error notifying discovery-service of room creation: ${error.message}`);
    }
  }

  /**
   * Notify discovery-service that broadcasting has started (IN_BROADCAST)
   */
  async notifyBroadcastStarted(roomId: string, userIds: string[]): Promise<void> {
    try {
      this.logger.log(`Broadcast started for room ${roomId} with users: ${userIds.join(", ")}`);
      
      // TODO: Call discovery-service API to update user statuses to IN_BROADCAST
      // await fetch(`${this.discoveryServiceUrl}/discovery/broadcast-started`, {
      //   method: "POST",
      //   headers: { "Content-Type": "application/json" },
      //   body: JSON.stringify({ roomId, userIds }),
      // });
    } catch (error: any) {
      this.logger.error(`Error notifying discovery-service of broadcast start: ${error.message}`);
    }
  }

  /**
   * Notify discovery-service that call has ended (update to AVAILABLE)
   */
  async notifyCallEnded(roomId: string, userIds: string[]): Promise<void> {
    try {
      this.logger.log(`Call ended for room ${roomId}, updating users to AVAILABLE: ${userIds.join(", ")}`);
      
      // TODO: Call discovery-service API to update user statuses to AVAILABLE
      // await fetch(`${this.discoveryServiceUrl}/discovery/call-ended`, {
      //   method: "POST",
      //   headers: { "Content-Type": "application/json" },
      //   body: JSON.stringify({ roomId, userIds }),
      // });
    } catch (error: any) {
      this.logger.error(`Error notifying discovery-service of call end: ${error.message}`);
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
      });

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
      });

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
   * Report a user (increment report count)
   */
  async reportUser(token: string, reportedUserId: string): Promise<{ reportCount: number }> {
    try {
      const response = await fetch(`${this.userServiceUrl}/users/report`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ reportedUserId })
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
}
