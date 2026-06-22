import { Injectable, OnModuleDestroy } from "@nestjs/common";

export interface MemeReactBrowserSettings {
  headless: boolean;
  channel?: "chrome" | "msedge" | "chromium";
  proxy?: {
    server: string;
    username?: string;
    password?: string;
  };
  locale: string;
  timezoneId: string;
  profileRootDir: string;
}

@Injectable()
export class MemeReactBrowserConfig implements OnModuleDestroy {
  private static readonly RELOAD_MS = 30_000;
  private cached: MemeReactBrowserSettings = this.parse();
  private reloadTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.reloadTimer = setInterval(() => {
      this.cached = this.parse();
    }, MemeReactBrowserConfig.RELOAD_MS);
  }

  onModuleDestroy() {
    if (this.reloadTimer) {
      clearInterval(this.reloadTimer);
      this.reloadTimer = null;
    }
  }

  getSettings(): MemeReactBrowserSettings {
    return { ...this.cached };
  }

  private parse(): MemeReactBrowserSettings {
    const headless = process.env.MEME_REACT_BROWSER_HEADLESS !== "false";
    const channelRaw = (process.env.MEME_REACT_BROWSER_CHANNEL ?? "").trim();
    const channel =
      channelRaw === "chrome" || channelRaw === "msedge" || channelRaw === "chromium"
        ? channelRaw
        : undefined;

    let proxy: MemeReactBrowserSettings["proxy"];
    const proxyUrl = (process.env.MEME_REACT_BROWSER_PROXY ?? "").trim();
    if (proxyUrl) {
      try {
        const parsed = new URL(proxyUrl);
        proxy = {
          server: `${parsed.protocol}//${parsed.host}`,
          username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
          password: parsed.password ? decodeURIComponent(parsed.password) : undefined
        };
      } catch {
        proxy = { server: proxyUrl };
      }
    }

    return {
      headless,
      channel,
      proxy,
      locale: (process.env.MEME_REACT_BROWSER_LOCALE ?? "en-US").trim() || "en-US",
      timezoneId: (process.env.MEME_REACT_BROWSER_TIMEZONE ?? "America/New_York").trim() || "America/New_York",
      profileRootDir: (process.env.MEME_REACT_BROWSER_PROFILE_DIR ?? "/tmp/meme-react-profiles").trim()
    };
  }
}
