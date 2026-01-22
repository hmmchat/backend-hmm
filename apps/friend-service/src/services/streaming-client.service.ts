import { Injectable, Logger } from "@nestjs/common";
import fetch from "node-fetch";

@Injectable()
export class StreamingClientService {
  private readonly logger = new Logger(StreamingClientService.name);
  private readonly streamingServiceUrl: string;

  constructor() {
    this.streamingServiceUrl = process.env.STREAMING_SERVICE_URL || "http://localhost:3006";
  }

  /**
   * Check if user is currently broadcasting and get room details
   * Returns null if user is not broadcasting
   */
  async getUserBroadcastStatus(userId: string): Promise<{
    isBroadcasting: boolean;
    roomId: string | null;
    broadcastUrl: string | null; // Deep link URL for the broadcast
  }> {
    try {
      const response = await fetch(
        `${this.streamingServiceUrl}/streaming/test/users/${userId}/room`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" }
        }
      );

      if (!response.ok) {
        // User is not in any room
        return {
          isBroadcasting: false,
          roomId: null,
          broadcastUrl: null
        };
      }

      const data = await response.json() as {
        exists: boolean;
        roomId?: string;
        isBroadcasting?: boolean;
        status?: string;
        role?: string;
      };

      if (!data.exists || !data.roomId) {
        return {
          isBroadcasting: false,
          roomId: null,
          broadcastUrl: null
        };
      }

      // Check if room is broadcasting
      // User must be a participant (not just a viewer) to be "broadcasting"
      const isParticipant = data.role === "participant";
      const isBroadcasting = isParticipant && 
                            (data.isBroadcasting === true || data.status === "IN_BROADCAST");

      if (isBroadcasting && data.roomId) {
        // Generate deep link URL for broadcast
        // Format: app.hmmchat.live/hmm_TV?roomId={roomId}
        // This will land directly on the specific broadcast in TikTok-like format
        const baseUrl = process.env.APP_DEEP_LINK_BASE_URL || "https://app.hmmchat.live";
        const broadcastUrl = `${baseUrl}/hmm_TV?roomId=${data.roomId}`;

        return {
          isBroadcasting: true,
          roomId: data.roomId,
          broadcastUrl
        };
      }

      return {
        isBroadcasting: false,
        roomId: data.roomId || null,
        broadcastUrl: null
      };
    } catch (error: any) {
      // Fail gracefully - if streaming service is unavailable, assume not broadcasting
      this.logger.warn(`Error checking broadcast status for ${userId}: ${error.message}`);
      return {
        isBroadcasting: false,
        roomId: null,
        broadcastUrl: null
      };
    }
  }

  /**
   * Get user status (online/offline/broadcasting)
   * This checks both user-service status and broadcast status
   */
  async getUserStatus(userId: string): Promise<{
    status: "online" | "offline" | "broadcasting";
    isBroadcasting: boolean;
    roomId: string | null;
    broadcastUrl: string | null;
  }> {
    // Check broadcast status first
    const broadcastStatus = await this.getUserBroadcastStatus(userId);

    if (broadcastStatus.isBroadcasting) {
      return {
        status: "broadcasting",
        isBroadcasting: true,
        roomId: broadcastStatus.roomId,
        broadcastUrl: broadcastStatus.broadcastUrl
      };
    }

    // TODO: Check user-service for online/offline status
    // For now, default to online if not broadcasting
    // In production, this should check user-service's status endpoint
    return {
      status: "online", // Default - should be checked from user-service
      isBroadcasting: false,
      roomId: null,
      broadcastUrl: null
    };
  }
}
