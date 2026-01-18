import { Injectable, Logger } from "@nestjs/common";
import fetch from "node-fetch";

@Injectable()
export class StreamingClientService {
  private readonly logger = new Logger(StreamingClientService.name);
  private readonly streamingServiceUrl: string;
  private readonly requestTimeoutMs: number;

  constructor() {
    this.streamingServiceUrl = process.env.STREAMING_SERVICE_URL || "http://localhost:3005";
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
}
