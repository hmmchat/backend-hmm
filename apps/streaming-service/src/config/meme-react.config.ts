import { Injectable, OnModuleDestroy } from "@nestjs/common";

interface MemeReactConfigSnapshot {
  enabled: boolean;
  whitelistUserIds: string[];
}

@Injectable()
export class MemeReactConfig implements OnModuleDestroy {
  private static readonly RELOAD_MS = 30_000;
  private cached: MemeReactConfigSnapshot = this.parse();
  private reloadTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.reloadTimer = setInterval(() => {
      this.cached = this.parse();
    }, MemeReactConfig.RELOAD_MS);
  }

  onModuleDestroy() {
    if (this.reloadTimer) {
      clearInterval(this.reloadTimer);
      this.reloadTimer = null;
    }
  }

  private parse(): MemeReactConfigSnapshot {
    const enabled = process.env.MEME_REACT_ENABLED === "true";
    const whitelistUserIds = (process.env.MEME_REACT_WHITELIST_USER_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return { enabled, whitelistUserIds };
  }

  isGloballyEnabled(): boolean {
    return this.cached.enabled && this.cached.whitelistUserIds.length > 0;
  }

  isUserWhitelisted(userId: string): boolean {
    if (!this.isGloballyEnabled()) return false;
    return this.cached.whitelistUserIds.includes(String(userId));
  }

  getPublicConfigForUser(userId: string) {
    const enabled = this.isGloballyEnabled();
    return {
      enabled,
      isWhitelisted: enabled && this.isUserWhitelisted(userId)
    };
  }
}
