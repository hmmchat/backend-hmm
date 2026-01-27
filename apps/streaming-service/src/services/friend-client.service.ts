import { Injectable, Logger } from "@nestjs/common";
import fetch from "node-fetch";

@Injectable()
export class FriendClientService {
  private readonly logger = new Logger(FriendClientService.name);
  private readonly friendServiceUrl: string;

  constructor() {
    this.friendServiceUrl = process.env.FRIEND_SERVICE_URL || "http://localhost:3009";
  }

  /**
   * Send friend request during call
   * Called when user clicks "+" button on participant's video/audio placeholder
   */
  async sendFriendRequestDuringCall(
    fromUserId: string,
    toUserId: string,
    roomId?: string
  ): Promise<{ requestId: string; autoAccepted: boolean }> {
    try {
      const serviceToken = process.env.INTERNAL_SERVICE_TOKEN;
      if (!serviceToken) {
        this.logger.error("INTERNAL_SERVICE_TOKEN not configured");
        throw new Error("Service authentication not configured");
      }

      const response = await fetch(`${this.friendServiceUrl}/internal/friends/requests`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-service-token": serviceToken
        },
        body: JSON.stringify({
          fromUserId,
          toUserId,
          roomId: roomId || null
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.warn(
          `Failed to send friend request from ${fromUserId} to ${toUserId}: ${errorText}`
        );
        throw new Error(`Failed to send friend request: ${errorText}`);
      }

      const result = await response.json() as { ok: boolean; requestId: string; autoAccepted: boolean };
      this.logger.log(
        `Friend request sent from ${fromUserId} to ${toUserId} (autoAccepted: ${result.autoAccepted})`
      );
      return {
        requestId: result.requestId,
        autoAccepted: result.autoAccepted
      };
    } catch (error: any) {
      this.logger.error(
        `Error sending friend request from ${fromUserId} to ${toUserId}: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Get relationship info batch for History Hotline (internal)
   * Returns { [otherUserId]: { isFriend, conversationId, messageCost } }
   */
  async getRelationshipsBatch(
    userId: string,
    otherUserIds: string[]
  ): Promise<Record<string, { isFriend: boolean; conversationId: string; messageCost: number }>> {
    if (otherUserIds.length === 0) {
      return {};
    }
    try {
      const serviceToken = process.env.INTERNAL_SERVICE_TOKEN;
      if (!serviceToken) {
        this.logger.warn("INTERNAL_SERVICE_TOKEN not configured, skipping relationship fetch");
        return {};
      }
      const response = await fetch(
        `${this.friendServiceUrl}/internal/friends/relationships`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-service-token": serviceToken
          },
          body: JSON.stringify({ userId, otherUserIds })
        }
      );
      if (!response.ok) {
        const text = await response.text();
        this.logger.warn(`Failed to fetch relationships batch: ${response.status} ${text}`);
        return {};
      }
      return (await response.json()) as Record<
        string,
        { isFriend: boolean; conversationId: string; messageCost: number }
      >;
    } catch (error: any) {
      this.logger.warn(`Error fetching relationships batch: ${error.message}`);
      return {};
    }
  }
}
