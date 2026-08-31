import { Injectable, Logger } from "@nestjs/common";
import fetch from "node-fetch";

export type AccountPurgeMode = "self" | "hard";

type PurgeTarget = {
  name: string;
  url: string;
};

@Injectable()
export class AccountPurgeClientService {
  private readonly logger = new Logger(AccountPurgeClientService.name);
  private readonly timeoutMs: number;
  private readonly internalToken: string | undefined;

  constructor() {
    this.timeoutMs = parseInt(process.env.ACCOUNT_PURGE_TIMEOUT_MS || "15000", 10);
    this.internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  }

  private targets(userId: string, mode: AccountPurgeMode): PurgeTarget[] {
    const q = `mode=${encodeURIComponent(mode)}`;
    const id = encodeURIComponent(userId);
    const friend = (process.env.FRIEND_SERVICE_URL || "http://localhost:3009").replace(/\/$/, "");
    const discovery = (process.env.DISCOVERY_SERVICE_URL || "http://localhost:3004").replace(/\/$/, "");
    const streaming = (process.env.STREAMING_SERVICE_URL || "http://localhost:3006").replace(/\/$/, "");
    const wallet = (process.env.WALLET_SERVICE_URL || "http://localhost:3005").replace(/\/$/, "");
    const files = (process.env.FILES_SERVICE_URL || "http://localhost:3008").replace(/\/$/, "");
    const moderation = (process.env.MODERATION_SERVICE_URL || "http://localhost:3003").replace(/\/$/, "");
    const payment = (process.env.PAYMENT_SERVICE_URL || "http://localhost:3007").replace(/\/$/, "");
    const ads = (process.env.ADS_SERVICE_URL || "http://localhost:3010").replace(/\/$/, "");

    return [
      { name: "friend-service", url: `${friend}/internal/users/${id}?${q}` },
      { name: "discovery-service", url: `${discovery}/discovery/internal/users/${id}?${q}` },
      { name: "streaming-service", url: `${streaming}/streaming/internal/users/${id}?${q}` },
      { name: "wallet-service", url: `${wallet}/internal/users/${id}?${q}` },
      { name: "files-service", url: `${files}/internal/users/${id}?${q}` },
      { name: "moderation-service", url: `${moderation}/internal/users/${id}?${q}` },
      { name: "payment-service", url: `${payment}/v1/payments/internal/users/${id}?${q}` },
      { name: "ads-service", url: `${ads}/internal/users/${id}?${q}` }
    ];
  }

  /**
   * Best-effort fan-out. Failures are logged and do not fail the caller — auth/profile
   * deletion should still complete so the user is not stuck mid-delete.
   */
  async purge(userId: string, mode: AccountPurgeMode): Promise<void> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.internalToken) {
      headers["x-internal-token"] = this.internalToken;
      headers["x-service-token"] = this.internalToken;
    }

    const targets = this.targets(userId, mode);
    const results = await Promise.allSettled(
      targets.map(async (target) => {
        const response = await fetch(target.url, {
          method: "DELETE",
          headers,
          signal: AbortSignal.timeout(this.timeoutMs)
        } as any);
        if (!response.ok && response.status !== 404) {
          const body = await response.text().catch(() => "");
          throw new Error(`${response.status} ${body.slice(0, 200)}`);
        }
      })
    );

    results.forEach((result, index) => {
      if (result.status === "rejected") {
        const name = targets[index]?.name || "unknown";
        this.logger.warn(
          `Account purge ${mode} failed for ${name} user=${userId}: ${result.reason?.message || result.reason}`
        );
      }
    });
  }
}
