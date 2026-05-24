import { Injectable, Logger } from "@nestjs/common";
import fetch from "node-fetch";

@Injectable()
export class DiscoveryClientService {
  private readonly logger = new Logger(DiscoveryClientService.name);
  private readonly discoveryServiceUrl: string;
  private readonly requestTimeoutMs: number;

  constructor() {
    this.discoveryServiceUrl = process.env.DISCOVERY_SERVICE_URL || "http://localhost:3004";
    this.requestTimeoutMs = parseInt(process.env.DISCOVERY_SERVICE_TIMEOUT_MS || "5000", 10);
  }

  /**
   * Returns true when discovery-service reports an active solo discovery session.
   * On failure, returns false (fail closed for AVAILABLE guard).
   */
  async hasActiveDiscoverySession(userId: string): Promise<boolean> {
    if (process.env.DISCOVERY_AVAILABLE_GUARD_ENABLED === "false") {
      return true;
    }

    try {
      const response = await fetch(
        `${this.discoveryServiceUrl}/discovery/internal/session/${encodeURIComponent(userId)}/active`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(this.requestTimeoutMs)
        } as any
      );

      if (!response.ok) {
        this.logger.warn(`Discovery session check failed for ${userId}: HTTP ${response.status}`);
        return false;
      }

      const data = (await response.json()) as { active?: boolean };
      return Boolean(data.active);
    } catch (error: any) {
      this.logger.warn(`Discovery session check error for ${userId}: ${error?.message || error}`);
      return false;
    }
  }
}
