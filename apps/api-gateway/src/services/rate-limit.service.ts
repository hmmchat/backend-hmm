import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient } from "redis";

export interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
}

@Injectable()
export class RateLimitService implements OnModuleInit {
  private readonly logger = new Logger(RateLimitService.name);
  private redisClient: ReturnType<typeof createClient> | null = null;
  private enabled: boolean = false;

  // Default rate limits
  private readonly defaultLimits: Map<string, RateLimitConfig> = new Map([
    ["/auth", { windowMs: 60000, maxRequests: 10 }], // 10 requests per minute
    ["/files/upload", { windowMs: 3600000, maxRequests: 20 }], // 20 uploads per hour
    ["/payments", { windowMs: 3600000, maxRequests: 10 }], // 10 payment attempts per hour
    ["default", { windowMs: 60000, maxRequests: 100 }] // 100 requests per minute for other endpoints
  ]);

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const redisUrl = this.configService.get<string>("REDIS_URL");
    const rateLimitEnabled = this.configService.get<string>("RATE_LIMIT_ENABLED") !== "false";

    if (!rateLimitEnabled) {
      this.logger.log("Rate limiting disabled");
      return;
    }

    if (!redisUrl) {
      this.logger.warn("Redis URL not configured. Rate limiting disabled.");
      return;
    }

    try {
      this.redisClient = createClient({ url: redisUrl });
      await this.redisClient.connect();
      this.enabled = true;
      this.logger.log("Rate limiting enabled with Redis");
    } catch (error: any) {
      this.logger.warn(`Failed to connect to Redis: ${error.message}. Rate limiting disabled.`);
      this.enabled = false;
    }
  }

  /**
   * Check if request should be rate limited
   */
  async checkRateLimit(
    identifier: string, // User ID or IP address
    path: string
  ): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    if (!this.enabled || !this.redisClient) {
      return { allowed: true, remaining: Infinity, resetAt: Date.now() + 60000 };
    }

    // Find rate limit config for this path
    let config = this.defaultLimits.get("default");
    for (const [routePath, routeConfig] of this.defaultLimits.entries()) {
      if (path.startsWith(routePath)) {
        config = routeConfig;
        break;
      }
    }

    if (!config) {
      return { allowed: true, remaining: Infinity, resetAt: Date.now() + 60000 };
    }

    const key = `rate_limit:${identifier}:${path}`;
    const windowSeconds = Math.floor(config.windowMs / 1000);

    try {
      const currentStr = await this.redisClient.incr(key);
      const current = typeof currentStr === 'string' ? parseInt(currentStr, 10) : currentStr;
      
      if (current === 1) {
        // First request in window, set expiration
        await this.redisClient.expire(key, windowSeconds);
      }

      const remaining = Math.max(0, config.maxRequests - current);
      const resetAt = Date.now() + config.windowMs;

      if (current > config.maxRequests) {
        return { allowed: false, remaining: 0, resetAt };
      }

      return { allowed: true, remaining, resetAt };
    } catch (error: any) {
      this.logger.error(`Rate limit check failed: ${error.message}`);
      // On error, allow request (fail open)
      return { allowed: true, remaining: Infinity, resetAt: Date.now() + 60000 };
    }
  }

  /**
   * Get rate limit identifier from request
   */
  getIdentifier(headers: Record<string, string>, ip?: string): string {
    // Try to get user ID from JWT token
    const authHeader = headers.authorization || headers.Authorization;
    if (authHeader) {
      try {
        const token = authHeader.replace("Bearer ", "");
        // Decode JWT to get user ID (without verification for rate limiting)
        // Only decode, don't verify (for performance)
        const parts = token.split(".");
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
          if (payload.sub) {
            return `user:${payload.sub}`;
          }
        }
      } catch {
        // If token parsing fails, fall back to IP
      }
    }

    // Fall back to IP address
    return ip ? `ip:${ip}` : "ip:unknown";
  }
}
