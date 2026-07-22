import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { rm } from "node:fs/promises";
import { MemeReactBrowserConfig } from "../config/meme-react-browser.config.js";
import {
  VIEWPORT_WIDTH,
  VIEWPORT_HEIGHT,
  IPHONE_USER_AGENT,
  getStealthChromium,
  ensureProfileDir,
  profileDirForSession,
  normalizeNavigationUrl,
  detectSiteBlock,
  buildChromiumArgs
} from "./meme-react-browser.stealth.js";

interface BrowserSession {
  callSessionId: string;
  lastUrl?: string;
  screencastActive: boolean;
  context: any;
  page: any;
  cdp: any;
}

type FrameHandler = (callSessionId: string, frameBase64: string) => void;

type BrowserInput = {
  type: "click" | "wheel" | "type" | "key" | "paste";
  x?: number;
  y?: number;
  deltaY?: number;
  text?: string;
  key?: string;
};

@Injectable()
export class MemeReactBrowserService implements OnModuleDestroy {
  private readonly logger = new Logger(MemeReactBrowserService.name);
  private readonly sessions = new Map<string, BrowserSession>();
  private frameHandler: FrameHandler | null = null;

  constructor(private readonly browserConfig: MemeReactBrowserConfig) {}

  setFrameHandler(handler: FrameHandler): void {
    this.frameHandler = handler;
  }

  async onModuleDestroy(): Promise<void> {
    for (const id of [...this.sessions.keys()]) {
      await this.destroySession(id, { purgeProfile: false });
    }
  }

  getLastUrl(callSessionId: string): string | undefined {
    return this.sessions.get(callSessionId)?.lastUrl;
  }

  async ensureSession(callSessionId: string): Promise<void> {
    if (this.sessions.has(callSessionId)) return;

    const settings = this.browserConfig.getSettings();
    const userDataDir = await ensureProfileDir(settings.profileRootDir, callSessionId);
    const chromium = await getStealthChromium();

    const launchOptions: Record<string, unknown> = {
      headless: settings.headless,
      args: buildChromiumArgs(),
      viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
      userAgent: IPHONE_USER_AGENT,
      locale: settings.locale,
      timezoneId: settings.timezoneId,
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      permissions: ["geolocation"],
      extraHTTPHeaders: {
        "Accept-Language": `${settings.locale},en;q=0.9`,
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Dest": "document"
      },
      ignoreDefaultArgs: ["--enable-automation"]
    };

    if (settings.channel) {
      launchOptions.channel = settings.channel;
    }
    if (settings.proxy) {
      launchOptions.proxy = settings.proxy;
    }

    this.logger.log(
      `Launching stealth browser for session ${callSessionId} (headless=${settings.headless}, proxy=${settings.proxy ? "yes" : "no"})`
    );

    const context = await chromium.launchPersistentContext(userDataDir, launchOptions);
    const page = context.pages()[0] ?? (await context.newPage());

    await page.addInitScript(`Object.defineProperty(navigator, "maxTouchPoints", { get: () => 5 });`);

    const cdp = await context.newCDPSession(page);

    this.sessions.set(callSessionId, {
      callSessionId,
      screencastActive: false,
      context,
      page,
      cdp
    });
  }

  async navigate(callSessionId: string, url: string): Promise<void> {
    const session = this.sessions.get(callSessionId);
    if (!session) throw new Error("Browser session not found");

    const targetUrl = normalizeNavigationUrl(url);
    try {
      await session.page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60_000
      });
      await new Promise((r) => setTimeout(r, 1200));

      const blockMessage = await detectSiteBlock(session.page, targetUrl);
      if (blockMessage) {
        this.logger.warn(`Site block detected for ${callSessionId}: ${blockMessage}`);
        throw new Error(blockMessage);
      }

      session.lastUrl = session.page.url();
    } catch (err: any) {
      const message = err?.message || "Failed to load page";
      this.logger.warn(`Navigate failed for ${callSessionId}: ${message}`);
      if (message.includes("Instagram") || message.includes("proxy")) {
        throw new Error(message);
      }
      throw new Error("Failed to load page — try again or pick another site");
    }
  }

  async startScreencast(callSessionId: string): Promise<void> {
    const session = this.sessions.get(callSessionId);
    if (!session || session.screencastActive) return;

    const { cdp } = session;
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 80,
      maxWidth: VIEWPORT_WIDTH,
      maxHeight: VIEWPORT_HEIGHT,
      everyNthFrame: 1
    });

    cdp.on("Page.screencastFrame", async (frame: { data: string; sessionId: number }) => {
      try {
        await cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId });
      } catch {
        /* ignore */
      }
      if (session.screencastActive) {
        this.frameHandler?.(callSessionId, frame.data);
      }
    });

    session.screencastActive = true;
  }

  async stopScreencast(callSessionId: string): Promise<void> {
    const session = this.sessions.get(callSessionId);
    if (!session?.screencastActive) return;
    session.screencastActive = false;
    try {
      await session.cdp.send("Page.stopScreencast");
    } catch {
      /* ignore */
    }
  }

  async handleInput(callSessionId: string, input: BrowserInput): Promise<void> {
    const session = this.sessions.get(callSessionId);
    if (!session) return;
    const { page } = session;

    if (input.type === "click" && input.x != null && input.y != null) {
      const x = Math.round(input.x * VIEWPORT_WIDTH);
      const y = Math.round(input.y * VIEWPORT_HEIGHT);
      try {
        await page.touchscreen.tap(x, y);
      } catch {
        await page.mouse.click(x, y);
      }
      return;
    }

    if (input.type === "wheel" && input.deltaY != null) {
      await page.mouse.wheel(0, input.deltaY);
      return;
    }

    if (input.type === "type" && input.text) {
      await page.keyboard.type(input.text, { delay: 35 });
      return;
    }

    if (input.type === "paste" && input.text) {
      await page.keyboard.insertText(input.text);
      return;
    }

    if (input.type === "key" && input.key) {
      await page.keyboard.press(input.key);
    }
  }

  async destroySession(
    callSessionId: string,
    opts?: { purgeProfile?: boolean }
  ): Promise<void> {
    const session = this.sessions.get(callSessionId);
    if (!session) return;

    await this.stopScreencast(callSessionId);
    try {
      await session.context.close();
    } catch {
      /* ignore */
    }
    this.sessions.delete(callSessionId);

    if (opts?.purgeProfile) {
      const settings = this.browserConfig.getSettings();
      const dir = profileDirForSession(settings.profileRootDir, callSessionId);
      try {
        await rm(dir, { recursive: true, force: true });
        this.logger.log(`Purged browser profile for session ${callSessionId}`);
      } catch (err: any) {
        this.logger.warn(`Failed to purge profile ${dir}: ${err?.message || err}`);
      }
    }
  }
}
