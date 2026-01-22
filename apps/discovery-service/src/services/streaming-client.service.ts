import { Injectable, Logger } from "@nestjs/common";
import fetch from "node-fetch";

@Injectable()
export class StreamingClientService {
  private readonly logger = new Logger(StreamingClientService.name);
  private readonly streamingServiceUrl: string;
  private readonly requestTimeoutMs: number;

  constructor() {
    this.streamingServiceUrl = process.env.STREAMING_SERVICE_URL || "http://localhost:3006";
    this.requestTimeoutMs = parseInt(process.env.STREAMING_SERVICE_TIMEOUT_MS || "5000", 10);
  }

  /**
   * Create a room for matched call (2 users)
   */
  async createMatchedRoom(userIds: string[]): Promise<{ roomId: string; sessionId: string }> {
    try {
      const response = await fetch(`${this.streamingServiceUrl}/streaming/rooms`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          userIds,
          callType: "matched"  // Use "matched" for matched calls
        }),
        signal: AbortSignal.timeout(this.requestTimeoutMs)
      } as any);

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.warn(`Failed to create matched room: ${errorText}`);
        throw new Error(`Failed to create matched room: ${errorText}`);
      }

      const result = await response.json() as { roomId: string; sessionId: string };
      this.logger.log(`Matched room created: ${result.roomId} with ${userIds.length} members`);
      return result;
    } catch (error: any) {
      if (error.name === "AbortError" || error.name === "TimeoutError") {
        this.logger.warn(`Timeout creating matched room for ${userIds.length} users`);
        throw new Error("Service timeout when creating matched room");
      }
      this.logger.error(`Error creating matched room:`, error.message);
      throw error;
    }
  }

  /**
   * Create a room for squad call
   */
  async createSquadRoom(userIds: string[]): Promise<{ roomId: string; sessionId: string }> {
    try {
      const response = await fetch(`${this.streamingServiceUrl}/streaming/rooms`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          userIds,
          callType: "squad"
        }),
        signal: AbortSignal.timeout(this.requestTimeoutMs)
      } as any);

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.warn(`Failed to create squad room: ${errorText}`);
        throw new Error(`Failed to create squad room: ${errorText}`);
      }

      const result = await response.json() as { roomId: string; sessionId: string };
      this.logger.log(`Squad room created: ${result.roomId} with ${userIds.length} members`);
      return result;
    } catch (error: any) {
      if (error.name === "AbortError" || error.name === "TimeoutError") {
        this.logger.warn(`Timeout creating squad room for ${userIds.length} users`);
        throw new Error("Service timeout when creating squad room");
      }
      this.logger.error(`Error creating squad room:`, error.message);
      throw error;
    }
  }

  /**
   * Get all active broadcasts (for HMM_TV feed)
   */
  async getActiveBroadcasts(): Promise<Array<{
    roomId: string;
    participantCount: number;
    viewerCount: number;
    participants: Array<{
      userId: string;
      role: string;
      joinedAt: Date;
    }>;
    startedAt: Date | null;
    createdAt: Date;
  }>> {
    try {
      const response = await fetch(`${this.streamingServiceUrl}/streaming/broadcasts`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json"
        },
        signal: AbortSignal.timeout(this.requestTimeoutMs)
      } as any);

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.warn(`Failed to get active broadcasts: ${errorText}`);
        throw new Error(`Failed to get active broadcasts: ${errorText}`);
      }

      const result: any = await response.json();
      // Handle both array response and object with broadcasts property
      const broadcasts = Array.isArray(result) 
        ? result 
        : (result.broadcasts || []);
      this.logger.log(`Retrieved ${broadcasts.length} active broadcasts`);
      return broadcasts;
    } catch (error: any) {
      if (error.name === "AbortError" || error.name === "TimeoutError") {
        this.logger.warn(`Timeout getting active broadcasts`);
        throw new Error("Service timeout when getting active broadcasts");
      }
      this.logger.error(`Error getting active broadcasts:`, error.message);
      throw error;
    }
  }

  /**
   * Send gift to a user in a broadcast room
   */
  async sendGift(
    roomId: string,
    fromUserId: string,
    toUserId: string,
    amount: number,
    giftId: string
  ): Promise<{
    success: boolean;
    transactionId?: string;
    newBalance?: number;
  }> {
    try {
      const response = await fetch(`${this.streamingServiceUrl}/streaming/test/rooms/${roomId}/gifts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          fromUserId,
          toUserId,
          amount,
          giftId
        }),
        signal: AbortSignal.timeout(this.requestTimeoutMs)
      } as any);

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.warn(`Failed to send gift: ${errorText}`);
        throw new Error(`Failed to send gift: ${errorText}`);
      }

      const result = await response.json() as {
        success: boolean;
        transactionId?: string;
        newBalance?: number;
      };
      return result;
    } catch (error: any) {
      if (error.name === "AbortError" || error.name === "TimeoutError") {
        this.logger.warn(`Timeout sending gift`);
        throw new Error("Service timeout when sending gift");
      }
      this.logger.error(`Error sending gift:`, error.message);
      throw error;
    }
  }
}
