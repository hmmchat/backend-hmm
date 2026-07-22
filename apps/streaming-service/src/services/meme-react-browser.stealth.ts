import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export const VIEWPORT_WIDTH = 390;
export const VIEWPORT_HEIGHT = 844;

/** Current iPhone Safari — matches Playwright mobile profile expectations. */
export const IPHONE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1";

let stealthChromium: any | null = null;

/**
 * Load playwright-extra with puppeteer-extra-plugin-stealth applied.
 * Must import from playwright-extra, not playwright, or stealth is not applied.
 */
export async function getStealthChromium() {
  if (stealthChromium) return stealthChromium;
  const { chromium } = await import("playwright-extra");
  const stealthModule = await import("puppeteer-extra-plugin-stealth");
  const StealthPlugin = stealthModule.default ?? stealthModule;
  chromium.use(StealthPlugin());
  stealthChromium = chromium;
  return chromium;
}

export function profileDirForSession(profileRoot: string, callSessionId: string): string {
  return join(profileRoot, callSessionId.replace(/[^a-zA-Z0-9_-]/g, "_"));
}

export async function ensureProfileDir(profileRoot: string, callSessionId: string): Promise<string> {
  const dir = profileDirForSession(profileRoot, callSessionId);
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Instagram serves a lighter mobile web app on m.instagram.com — better match for our iPhone viewport.
 */
export function normalizeNavigationUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === "instagram.com" || host === "www.instagram.com" || host === "m.instagram.com") {
      parsed.hostname = "www.instagram.com";
      // Reels / feed work on www with mobile UA; m. redirects inconsistently for login flows.
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export function isInstagramHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "instagram.com" || host.endsWith(".instagram.com");
  } catch {
    return false;
  }
}

/** Detect common Instagram bot / rate-limit screens after navigation. */
export async function detectSiteBlock(page: any, url: string): Promise<string | null> {
  const currentUrl = page.url?.() ?? url;
  if (isInstagramHost(currentUrl)) {
    if (/challenge|consent|accounts\/login/.test(currentUrl) && /challenge/.test(currentUrl)) {
      return "Instagram security check — wait a moment and try again";
    }
  }

  let snippet = "";
  try {
    snippet = String(await page.evaluate("document.body?.innerText?.slice(0, 3000) ?? ''"));
  } catch {
    return null;
  }

  const blockedPatterns = [
    /automated behavior/i,
    /suspicious activity/i,
    /try again later/i,
    /we restrict certain activity/i,
    /confirm you(?:'|’)re human/i,
    /unusual activity/i,
    /help us confirm/i,
    /checkpoint/i
  ];

  if (blockedPatterns.some((re) => re.test(snippet))) {
    return "Instagram blocked automated access — configure MEME_REACT_BROWSER_PROXY with a residential IP and retry";
  }

  return null;
}

export function buildChromiumArgs(): string[] {
  return [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-blink-features=AutomationControlled",
    "--disable-infobars",
    `--window-size=${VIEWPORT_WIDTH},${VIEWPORT_HEIGHT}`,
    "--disable-features=IsolateOrigins,site-per-process",
    "--lang=en-US,en"
  ];
}
