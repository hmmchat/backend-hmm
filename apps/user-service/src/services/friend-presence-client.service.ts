import { Injectable, Logger } from "@nestjs/common";
import fetch from "node-fetch";

/**
 * Asks friend-service to push a status change to inbox peers.
 * Status writes must succeed even when this call fails.
 */
@Injectable()
export class FriendPresenceClientService {
  private readonly logger = new Logger(FriendPresenceClientService.name);
  private readonly friendServiceUrl: string;

  constructor() {
    this.friendServiceUrl = process.env.FRIEND_SERVICE_URL || "http://localhost:3009";
  }

  notifyStatusChanged(userId: string, status: string): void {
    const token = process.env.INTERNAL_SERVICE_TOKEN;
    if (!token) {
      this.logger.warn("INTERNAL_SERVICE_TOKEN is not configured; inbox presence will not update");
      return;
    }

    void fetch(`${this.friendServiceUrl}/internal/friends/presence`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-service-token": token
      },
      body: JSON.stringify({ userId, status }),
      signal: AbortSignal.timeout(4000)
    } as any)
      .then((response) => {
        if (!response.ok) {
          this.logger.warn(
            `Inbox presence notify failed for ${userId} (${status}): HTTP ${response.status}`
          );
        }
      })
      .catch((error: any) => {
        this.logger.warn(
          `Inbox presence notify failed for ${userId} (${status}): ${error?.message || error}`
        );
      });
  }
}
