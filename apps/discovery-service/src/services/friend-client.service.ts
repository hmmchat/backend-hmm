import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import fetch from "node-fetch";

@Injectable()
export class FriendClientService {
  private readonly logger = new Logger(FriendClientService.name);
  private readonly friendServiceUrl: string;
  private readonly requestTimeoutMs: number;

  constructor() {
    this.friendServiceUrl = process.env.FRIEND_SERVICE_URL || "http://localhost:3009";
    this.requestTimeoutMs = parseInt(process.env.FRIEND_SERVICE_TIMEOUT_MS || "5000", 10);
  }

  /**
   * Check if two users are friends
   */
  async areFriends(userId1: string, userId2: string): Promise<boolean> {
    try {
      // Call friend service internal endpoint to check friendship
      // We'll need to add an internal endpoint for this, or use the existing /me/friends endpoint
      // For now, let's use a workaround by checking if friend request was accepted
      
      const serviceToken = process.env.INTERNAL_SERVICE_TOKEN;
      if (!serviceToken) {
        this.logger.warn("INTERNAL_SERVICE_TOKEN not configured, cannot check friendship");
        throw new Error("Service authentication not configured");
      }

      // Use internal endpoint to check friendship
      const response = await fetch(
        `${this.friendServiceUrl}/internal/friends/check?userId1=${userId1}&userId2=${userId2}`,
        {
          method: "GET",
          headers: {
            "x-service-token": serviceToken,
            "Content-Type": "application/json"
          },
          signal: AbortSignal.timeout(this.requestTimeoutMs)
        } as any
      );

      if (!response.ok) {
        // If endpoint doesn't exist (404), return false (assume not friends)
        if (response.status === 404) {
          this.logger.warn("Friendship check endpoint not available, assuming not friends");
          return false;
        }
        const errorText = await response.text();
        this.logger.warn(`Failed to check friendship between ${userId1} and ${userId2}: ${errorText}`);
        // Return false on error (graceful degradation)
        return false;
      }

      const result = await response.json() as { areFriends: boolean };
      return result.areFriends || false;
    } catch (error: any) {
      if (error.name === "AbortError" || error.name === "TimeoutError") {
        this.logger.warn(`Timeout checking friendship between ${userId1} and ${userId2}`);
        throw new HttpException(
          "Service timeout when checking friendship",
          HttpStatus.REQUEST_TIMEOUT
        );
      }
      this.logger.error(
        `Error checking friendship between ${userId1} and ${userId2}:`,
        error.message
      );
      // Return false on error (assume not friends) - graceful degradation
      return false;
    }
  }

  /**
   * Auto-create friendship between two users (for external users accepting squad invites)
   */
  async autoCreateFriendship(userId1: string, userId2: string): Promise<void> {
    try {
      const serviceToken = process.env.INTERNAL_SERVICE_TOKEN;
      if (!serviceToken) {
        this.logger.error("INTERNAL_SERVICE_TOKEN not configured");
        throw new Error("Service authentication not configured");
      }

      // Call internal endpoint to auto-create friendship
      const response = await fetch(
        `${this.friendServiceUrl}/internal/friends/auto-create`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-service-token": serviceToken
          },
          body: JSON.stringify({
            userId1,
            userId2
          }),
          signal: AbortSignal.timeout(this.requestTimeoutMs)
        } as any
      );

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.warn(
          `Failed to auto-create friendship between ${userId1} and ${userId2}: ${errorText}`
        );
        throw new Error(`Failed to auto-create friendship: ${errorText}`);
      }

      this.logger.log(
        `Auto-created friendship between ${userId1} and ${userId2}`
      );
    } catch (error: any) {
      if (error.name === "AbortError" || error.name === "TimeoutError") {
        this.logger.warn(`Timeout auto-creating friendship between ${userId1} and ${userId2}`);
        throw new HttpException(
          "Service timeout when auto-creating friendship",
          HttpStatus.REQUEST_TIMEOUT
        );
      }
      this.logger.error(
        `Error auto-creating friendship between ${userId1} and ${userId2}:`,
        error.message
      );
      throw error;
    }
  }

  /**
   * Get user's friends list (for inviting to squad)
   */
  async getFriends(userId: string, limit: number = 50): Promise<Array<{ friendId: string; createdAt: Date }>> {
    try {
      const serviceToken = process.env.INTERNAL_SERVICE_TOKEN;
      if (!serviceToken) {
        this.logger.warn("INTERNAL_SERVICE_TOKEN not configured, cannot get friends");
        throw new Error("Service authentication not configured");
      }

      const response = await fetch(
        `${this.friendServiceUrl}/internal/friends?userId=${userId}&limit=${limit}`,
        {
          method: "GET",
          headers: {
            "x-service-token": serviceToken,
            "Content-Type": "application/json"
          },
          signal: AbortSignal.timeout(this.requestTimeoutMs)
        } as any
      );

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.warn(`Failed to get friends for ${userId}: ${errorText}`);
        throw new Error(`Failed to get friends: ${errorText}`);
      }

      const result = await response.json() as { friends: Array<{ friendId: string; createdAt: string }> };
      return result.friends.map(f => ({
        friendId: f.friendId,
        createdAt: new Date(f.createdAt)
      }));
    } catch (error: any) {
      if (error.name === "AbortError" || error.name === "TimeoutError") {
        this.logger.warn(`Timeout getting friends for ${userId}`);
        throw new HttpException(
          "Service timeout when getting friends",
          HttpStatus.REQUEST_TIMEOUT
        );
      }
      this.logger.error(`Error getting friends for ${userId}:`, error.message);
      throw error;
    }
  }

  /**
   * Record squad invite or outcome in friend inbox (best-effort; logs on failure).
   */
  async postSquadInboxMessage(
    payload:
      | { kind: "invite"; inviterId: string; inviteeId: string; invitationId: string }
      | {
          kind: "outcome";
          inviterId: string;
          inviteeId: string;
          invitationId: string;
          outcome: "accepted" | "rejected";
          message?: string;
        }
      | {
          kind: "notice";
          fromUserId: string;
          toUserId: string;
          invitationId: string;
          noticeType: string;
          body: string;
        }
  ): Promise<void> {
    try {
      const serviceToken = process.env.INTERNAL_SERVICE_TOKEN;
      if (!serviceToken) {
        this.logger.warn("INTERNAL_SERVICE_TOKEN not configured; skipping squad inbox message");
        return;
      }

      const response = await fetch(`${this.friendServiceUrl}/internal/messages/squad`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-service-token": serviceToken
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.requestTimeoutMs)
      } as any);

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.warn(`postSquadInboxMessage failed (${response.status}): ${errorText}`);
      }
    } catch (error: any) {
      this.logger.warn(`postSquadInboxMessage error: ${error.message}`);
    }
  }
}
