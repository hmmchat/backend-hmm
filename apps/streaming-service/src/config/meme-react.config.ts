import { Injectable, OnModuleDestroy } from "@nestjs/common";

export interface SitePickerEntry {
  host: string;
  label: string;
  url: string;
}

interface MemeReactConfigSnapshot {
  enabled: boolean;
  whitelistUserIds: string[];
  sites: SitePickerEntry[];
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
    const sites = this.parseSiteEntries(process.env.MEME_REACT_URL_ALLOWLIST ?? "");
    return { enabled, whitelistUserIds, sites };
  }

  /**
   * Entries: host|Label|https://start-url — comma or newline separated.
   * Example: instagram.com|Instagram|https://www.instagram.com,reddit.com|Reddit|https://www.reddit.com
   */
  private parseSiteEntries(raw: string): SitePickerEntry[] {
    const parts = raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    const sites: SitePickerEntry[] = [];
    for (const part of parts) {
      const segments = part.split("|").map((s) => s.trim());
      if (segments.length < 3) continue;
      const [host, label, url] = segments;
      if (!host || !label || !url) continue;
      try {
        const parsed = new URL(url);
        sites.push({ host: host.toLowerCase(), label, url: parsed.toString() });
      } catch {
        // skip invalid URL
      }
    }
    return sites;
  }

  isGloballyEnabled(): boolean {
    return this.cached.enabled && this.cached.whitelistUserIds.length > 0;
  }

  isUserWhitelisted(userId: string): boolean {
    if (!this.isGloballyEnabled()) return false;
    return this.cached.whitelistUserIds.includes(String(userId));
  }

  getSitePickerEntries(): SitePickerEntry[] {
    return [...this.cached.sites];
  }

  getPublicConfigForUser(userId: string) {
    const enabled = this.isGloballyEnabled();
    return {
      enabled,
      isWhitelisted: enabled && this.isUserWhitelisted(userId),
      sites: enabled
        ? this.cached.sites.map((s) => ({
            host: s.host,
            label: s.label,
            url: s.url,
            faviconUrl: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(s.host)}&sz=64`
          }))
        : []
    };
  }

  hostnameMatchesAllowlist(hostname: string): boolean {
    const host = hostname.toLowerCase();
    return this.cached.sites.some((site) => {
      const allowed = site.host.toLowerCase();
      return host === allowed || host.endsWith(`.${allowed}`);
    });
  }

  isUrlAllowed(url: string): boolean {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
      return this.hostnameMatchesAllowlist(parsed.hostname);
    } catch {
      return false;
    }
  }

  findSiteByUrl(url: string): SitePickerEntry | undefined {
    if (!this.isUrlAllowed(url)) return undefined;
    try {
      const host = new URL(url).hostname.toLowerCase();
      return this.cached.sites.find((s) => {
        const allowed = s.host.toLowerCase();
        return host === allowed || host.endsWith(`.${allowed}`);
      });
    } catch {
      return undefined;
    }
  }
}
