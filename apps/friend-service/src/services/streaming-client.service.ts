import { Injectable, Logger } from "@nestjs/common";
import { mapUserStatusToMessagingPresence } from "@hmm/common";
import fetch from "node-fetch";
import { UserClientService } from "./user-client.service.js";

export type MessagingUserPresence = {
  status: "online" | "offline" | "broadcasting";
  isBroadcasting: boolean;
  roomId: string | null;
  broadcastUrl: string | null;
};

@Injectable()
export class StreamingClientService {
  private readonly logger = new Logger(StreamingClientService.name);
  private readonly streamingServiceUrl: string;

  constructor(private readonly userClient: UserClientService) {
    this.streamingServiceUrl = process.env.STREAMING_SERVICE_URL || "http://localhost:3006";
  }

  /**
   * Check if user is currently broadcasting and get room details
   * Returns null if user is not broadcasting
   */
  async getUserBroadcastStatus(userId: string): Promise<{
    isBroadcasting: boolean;
    roomId: string | null;
    broadcastUrl: string | null;
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
        return {
          isBroadcasting: false,
          roomId: null,
          broadcastUrl: null
        };
      }

      const data = (await response.json()) as {
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

      const isParticipant = data.role === "participant";
      const isBroadcasting =
        isParticipant && (data.isBroadcasting === true || data.status === "IN_BROADCAST");

      if (isBroadcasting && data.roomId) {
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
      this.logger.warn(`Error checking broadcast status for ${userId}: ${error.message}`);
      return {
        isBroadcasting: false,
        roomId: null,
        broadcastUrl: null
      };
    }
  }

  private offlinePresence(): MessagingUserPresence {
    return {
      status: "offline",
      isBroadcasting: false,
      roomId: null,
      broadcastUrl: null
    };
  }

  /**
   * Batch presence for messaging UI (green dot / broadcast badge).
   */
  async getUserStatuses(userIds: string[]): Promise<Map<string, MessagingUserPresence>> {
    const result = new Map<string, MessagingUserPresence>();
    if (userIds.length === 0) {
      return result;
    }

    const uniqueIds = [...new Set(userIds)];
    const [effectiveStatuses, broadcastStatuses] = await Promise.all([
      this.userClient.getEffectiveStatuses(uniqueIds),
      Promise.all(
        uniqueIds.map(async (userId) => ({
          userId,
          broadcast: await this.getUserBroadcastStatus(userId)
        }))
      )
    ]);

    const broadcastMap = new Map(
      broadcastStatuses.map((entry) => [entry.userId, entry.broadcast])
    );

    for (const userId of uniqueIds) {
      const effectiveStatus = effectiveStatuses.get(userId) || "OFFLINE";
      const broadcast = broadcastMap.get(userId) || {
        isBroadcasting: false,
        roomId: null,
        broadcastUrl: null
      };

      result.set(userId, {
        status: mapUserStatusToMessagingPresence(effectiveStatus, broadcast.isBroadcasting),
        isBroadcasting: broadcast.isBroadcasting,
        roomId: broadcast.roomId,
        broadcastUrl: broadcast.broadcastUrl
      });
    }

    return result;
  }

  /**
   * Get user status (online/offline/broadcasting) for messaging.
   */
  async getUserStatus(userId: string): Promise<MessagingUserPresence> {
    const statuses = await this.getUserStatuses([userId]);
    return statuses.get(userId) || this.offlinePresence();
  }
}
