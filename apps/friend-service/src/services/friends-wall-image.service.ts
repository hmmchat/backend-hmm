import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import puppeteer, { Browser, Page } from "puppeteer";
import * as crypto from "crypto";
import sharp from "sharp";
import { FriendService } from "./friend.service.js";
import { UserClientService } from "./user-client.service.js";
import { RedisService } from "./redis.service.js";
import { MetricsService } from "./metrics.service.js";

interface CachedImage {
  imageUrl: string;
  deepLink: string;
  fileId: string;
  createdAt: string;
}

@Injectable()
export class FriendsWallImageService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FriendsWallImageService.name);
  private browser: Browser | null = null;
  private readonly cacheTtl: number;
  private readonly productLink: string;

  constructor(
    private readonly friendService: FriendService,
    private readonly userClient: UserClientService,
    private readonly redis: RedisService,
    private readonly metrics: MetricsService
  ) {
    this.cacheTtl = parseInt(process.env.FRIENDS_WALL_CACHE_TTL || "86400", 10); // 24 hours default
    this.productLink = process.env.PRODUCT_LINK || "https://hmmchat.live";
  }

  async onModuleInit() {
    try {
      const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
      this.browser = await puppeteer.launch({
        headless: true,
        executablePath,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--no-first-run",
          "--no-zygote",
          "--disable-gpu"
        ],
        timeout: 30000
      });
      this.logger.log("Puppeteer browser launched successfully");
      
      // Set up browser error handlers
      this.browser.on("disconnected", () => {
        this.logger.warn("Puppeteer browser disconnected");
        this.browser = null;
      });
    } catch (error: any) {
      this.logger.error(`Failed to launch Puppeteer browser: ${error.message}`);
      this.browser = null;
      // Don't throw - service can still work, but image generation will fail gracefully
    }
  }

  async onModuleDestroy() {
    if (this.browser) {
      await this.browser.close();
      this.logger.log("Puppeteer browser closed");
    }
  }

  /**
   * Generate hash of friends list for cache key
   */
  private generateFriendsHash(friendIds: string[]): string {
    const sortedIds = [...friendIds].sort().join(",");
    return crypto.createHash("md5").update(sortedIds).digest("hex");
  }

  /**
   * Get cached image if available
   */
  async getCachedImage(userId: string, friendsHash: string): Promise<{ imageUrl: string; deepLink: string } | null> {
    if (!this.redis.isAvailable()) {
      return null;
    }

    try {
      const cacheKey = `friends-wall-share:${userId}:${friendsHash}`;
      const cached = await this.redis.get(cacheKey);
      
      if (cached) {
        const data = JSON.parse(cached) as CachedImage;
        this.logger.debug(`Cache hit for user ${userId}`);
        return {
          imageUrl: data.imageUrl,
          deepLink: data.deepLink
        };
      }
    } catch (error: any) {
      this.logger.warn(`Error reading cache: ${error.message}`);
    }

    return null;
  }

  /**
   * Get all cached images older than specified days
   * Returns array of { userId, friendsHash, fileId, createdAt, cacheKey }
   */
  async getOldCachedImages(olderThanDays: number): Promise<Array<{
    userId: string;
    friendsHash: string;
    fileId: string;
    createdAt: Date;
    cacheKey: string;
  }>> {
    if (!this.redis.isAvailable()) {
      return [];
    }

    const oldImages: Array<{
      userId: string;
      friendsHash: string;
      fileId: string;
      createdAt: Date;
      cacheKey: string;
    }> = [];

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      // Get all keys matching the pattern
      const pattern = "friends-wall-share:*";
      const keys = await this.redis.keys(pattern);

      for (const cacheKey of keys) {
        try {
          const cached = await this.redis.get(cacheKey);
          if (cached) {
            const data = JSON.parse(cached) as CachedImage;
            const createdAt = new Date(data.createdAt);

            if (createdAt < cutoffDate && data.fileId) {
              // Extract userId and friendsHash from cache key
              // Format: friends-wall-share:userId:friendsHash
              const parts = cacheKey.split(":");
              if (parts.length === 3) {
                oldImages.push({
                  userId: parts[1],
                  friendsHash: parts[2],
                  fileId: data.fileId,
                  createdAt,
                  cacheKey
                });
              }
            }
          }
        } catch (error: any) {
          this.logger.warn(`Error processing cache key ${cacheKey}: ${error.message}`);
        }
      }
    } catch (error: any) {
      this.logger.error(`Error getting old cached images: ${error.message}`);
    }

    return oldImages;
  }

  /**
   * Remove cached image entry from Redis
   */
  async removeCachedImage(cacheKey: string): Promise<void> {
    if (!this.redis.isAvailable()) {
      return;
    }

    try {
      await this.redis.del(cacheKey);
    } catch (error: any) {
      this.logger.warn(`Error removing cache entry ${cacheKey}: ${error.message}`);
    }
  }

  /**
   * Cache generated image
   */
  async cacheImage(userId: string, friendsHash: string, imageUrl: string, deepLink: string, fileId: string): Promise<void> {
    if (!this.redis.isAvailable()) {
      return;
    }

    try {
      const cacheKey = `friends-wall-share:${userId}:${friendsHash}`;
      const data: CachedImage = {
        imageUrl,
        deepLink,
        fileId,
        createdAt: new Date().toISOString()
      };
      await this.redis.set(cacheKey, JSON.stringify(data), this.cacheTtl);
    } catch (error: any) {
      this.logger.warn(`Error caching image: ${error.message}`);
    }
  }

  /**
   * Generate HTML template for friend wall
   */
  private generateHTMLTemplate(
    username: string | null,
    userPhotoUrl: string | null,
    friends: Array<{ friendId: string; photoUrl: string | null }>,
    productLink: string
  ): string {
    const displayUsername = username || "User";
    const userPhoto = userPhotoUrl || this.getPlaceholderImage();
    
    // Generate friend grid HTML
    const friendGrid = friends
      .map((friend, index) => {
        const photo = friend.photoUrl || this.getPlaceholderImage();
        return `<div class="friend-item" style="background-image: url('${photo}');"></div>`;
      })
      .join("");

    const emptyState = friends.length === 0
      ? '<div class="empty-state"><p>No friends yet</p><p class="cta">Start connecting!</p></div>'
      : "";

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      width: 1080px;
      height: 1920px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 60px 40px;
      color: white;
    }
    .header {
      text-align: center;
      margin-bottom: 40px;
    }
    .user-photo {
      width: 120px;
      height: 120px;
      border-radius: 60px;
      border: 4px solid white;
      background-size: cover;
      background-position: center;
      margin: 0 auto 20px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    }
    .username {
      font-size: 36px;
      font-weight: bold;
      margin-bottom: 10px;
      text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
    }
    .subtitle {
      font-size: 24px;
      opacity: 0.9;
      margin-bottom: 30px;
    }
    .friends-grid {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 12px;
      width: 100%;
      max-width: 1000px;
      margin-bottom: 40px;
    }
    .friend-item {
      aspect-ratio: 1;
      border-radius: 12px;
      background-size: cover;
      background-position: center;
      border: 2px solid rgba(255,255,255,0.3);
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    }
    .empty-state {
      text-align: center;
      padding: 60px 20px;
    }
    .empty-state p {
      font-size: 32px;
      margin-bottom: 20px;
    }
    .empty-state .cta {
      font-size: 24px;
      opacity: 0.8;
    }
    .footer {
      margin-top: auto;
      text-align: center;
      padding-top: 40px;
    }
    .logo {
      font-size: 28px;
      font-weight: bold;
      margin-bottom: 10px;
    }
    .product-link {
      font-size: 20px;
      opacity: 0.8;
      text-decoration: none;
      color: white;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="user-photo" style="background-image: url('${userPhoto}');"></div>
    <div class="username">${this.escapeHtml(displayUsername)}</div>
    <div class="subtitle">Friend Wall</div>
  </div>
  ${emptyState}
  <div class="friends-grid">
    ${friendGrid}
  </div>
  <div class="footer">
    <div class="logo">hmmchat</div>
    <a href="${productLink}" class="product-link">${productLink}</a>
  </div>
</body>
</html>`;
  }

  /**
   * Escape HTML to prevent XSS
   */
  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  /**
   * Get placeholder image as data URI
   */
  private getPlaceholderImage(): string {
    // Simple gray placeholder (1x1 pixel PNG, base64 encoded)
    return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  }

  /**
   * Check if browser is healthy and available
   */
  isBrowserHealthy(): boolean {
    return this.browser !== null && this.browser.isConnected();
  }

  /**
   * Restart browser if it's not healthy
   */
  async restartBrowserIfNeeded(): Promise<void> {
    if (!this.isBrowserHealthy()) {
      this.logger.warn("Browser not healthy, attempting restart...");
      if (this.browser) {
        try {
          await this.browser.close();
        } catch (error) {
          // Ignore errors during close
        }
      }
      await this.onModuleInit();
    }
  }

  /**
   * Optimize image using sharp
   * Compresses JPEG to target size (<500KB for social sharing)
   */
  private async optimizeImage(buffer: Buffer): Promise<Buffer> {
    try {
      const targetSizeBytes = 500 * 1024; // 500KB target
      let quality = 85;
      let optimized = buffer;

      // Try to optimize to target size
      for (let attempt = 0; attempt < 5; attempt++) {
        optimized = await sharp(buffer)
          .jpeg({ 
            quality,
            mozjpeg: true,
            progressive: true
          })
          .toBuffer();

        // If we're under target size or quality is too low, stop
        if (optimized.length <= targetSizeBytes || quality <= 50) {
          break;
        }

        // Reduce quality for next attempt
        quality -= 10;
      }

      this.logger.debug(`Image optimized: ${buffer.length} -> ${optimized.length} bytes (quality: ${quality})`);
      return optimized;
    } catch (error: any) {
      this.logger.warn(`Image optimization failed: ${error.message}, using original`);
      return buffer; // Return original if optimization fails
    }
  }

  /**
   * Generate friend wall image
   * Note: Cache check is done at controller level, so this always generates
   */
  async generateImage(userId: string): Promise<Buffer> {
    // Check and restart browser if needed
    if (!this.isBrowserHealthy()) {
      await this.restartBrowserIfNeeded();
      if (!this.browser) {
        throw new Error("Puppeteer browser not available and restart failed");
      }
    }

    let page: Page | null = null;
    const startTime = Date.now();

    try {
      // Fetch friend wall data
      const friendsWall = await this.friendService.getFriendsWall(userId, 35); // Get first 35 friends

      // Fetch user profile
      const userProfile = await this.userClient.getUserProfile(userId);

      // Generate HTML
      const html = this.generateHTMLTemplate(
        userProfile.username,
        userProfile.displayPictureUrl,
        friendsWall.friends,
        this.productLink
      );

      // Create new page
      page = await this.browser.newPage();
      await page.setViewport({ width: 1080, height: 1920 });
      await page.setDefaultTimeout(15000);

      // Set content and wait for load
      await page.setContent(html, { waitUntil: "load" });
      
      // Wait a bit for any images to load
      await page.waitForTimeout(1000);

      // Take screenshot
      let imageBuffer = await page.screenshot({
        type: "jpeg",
        quality: 90,
        fullPage: false
      }) as Buffer;

      // Optimize image before returning
      imageBuffer = await this.optimizeImage(imageBuffer);

      const duration = Date.now() - startTime;
      this.metrics.incrementFriendsWallShareGenerated(true, duration);

      return imageBuffer;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.metrics.incrementFriendsWallShareGenerated(false, duration);
      this.logger.error(`Error generating friend wall image: ${error.message}`);
      throw new Error(`Failed to generate image: ${error.message}`);
    } finally {
      if (page) {
        await page.close();
      }
    }
  }

  /**
   * Get product link
   */
  getProductLink(): string {
    return this.productLink;
  }
}
