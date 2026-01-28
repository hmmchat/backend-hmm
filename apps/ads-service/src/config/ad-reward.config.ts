import { Injectable } from "@nestjs/common";

@Injectable()
export class AdRewardConfigService {
  // Coins per ad reward
  getCoinsPerAd(): number {
    return parseInt(process.env.AD_REWARD_COINS_PER_AD || "10", 10);
  }

  // Cooldown period in seconds (minimum time between ads)
  getCooldownSeconds(): number {
    return parseInt(process.env.AD_REWARD_COOLDOWN_SECONDS || "300", 10);
  }

  // Maximum ads per day per user (optional, null means no limit)
  getMaxAdsPerDay(): number | null {
    const max = process.env.AD_REWARD_MAX_PER_DAY;
    if (!max || max === "null" || max === "undefined") {
      return null;
    }
    return parseInt(max, 10);
  }

  // Whether ad rewards are enabled
  isAdRewardEnabled(): boolean {
    return process.env.AD_REWARD_ENABLED !== "false";
  }

  // Wallet service URL
  getWalletServiceUrl(): string {
    return process.env.WALLET_SERVICE_URL || "http://localhost:3005";
  }

  // Ad Manager Network ID (optional, for server-side verification)
  getAdManagerNetworkId(): string | null {
    const id = process.env.AD_MANAGER_NETWORK_ID;
    if (!id || id === "undefined") {
      return null;
    }
    return id;
  }

  // Ad Manager Ad Unit Path (optional)
  getAdManagerAdUnitPath(): string | null {
    const path = process.env.AD_MANAGER_AD_UNIT_PATH;
    if (!path || path === "undefined") {
      return null;
    }
    return path;
  }

  // AdSense Publisher ID (optional, if using AdSense)
  getAdSensePublisherId(): string | null {
    const id = process.env.ADSENSE_PUBLISHER_ID;
    if (!id || id === "undefined") {
      return null;
    }
    return id;
  }

  // AdSense Ad Unit ID (optional)
  getAdSenseAdUnitId(): string | null {
    const id = process.env.ADSENSE_AD_UNIT_ID;
    if (!id || id === "undefined") {
      return null;
    }
    return id;
  }
}
