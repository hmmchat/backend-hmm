import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from "@nestjs/common";
import { RedisService } from "../services/redis.service.js";

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly MESSAGE_RATE_LIMIT = parseInt(process.env.MESSAGE_RATE_LIMIT || "10", 10);
  private readonly GIFT_RATE_LIMIT = parseInt(process.env.GIFT_RATE_LIMIT || "5", 10);
  private readonly RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW || "60", 10);

  constructor(private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    // Only apply to POST requests for messages/gifts
    if (request.method !== "POST") {
      return true;
    }

    const isMessageEndpoint = request.url.includes("/messages");
    const isGiftEndpoint = request.url.includes("/gift");

    if (!isMessageEndpoint && !isGiftEndpoint) {
      return true;
    }

    // Extract userId from request (should be set by auth middleware/guard)
    const userId = (request as any).user?.sub || (request as any).userId;
    if (!userId) {
      return true; // Skip rate limiting if no user ID
    }

    const limit = isGiftEndpoint ? this.GIFT_RATE_LIMIT : this.MESSAGE_RATE_LIMIT;
    const key = `rate_limit:${isGiftEndpoint ? "gift" : "message"}:${userId}`;

    if (!this.redis.isAvailable()) {
      // If Redis is not available, skip rate limiting (log warning)
      console.warn("Redis not available, skipping rate limiting");
      return true;
    }

    try {
      const current = await this.redis.get(key);
      const count = current ? parseInt(current, 10) : 0;

      if (count >= limit) {
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: `Rate limit exceeded. Maximum ${limit} ${isGiftEndpoint ? "gifts" : "messages"} per ${this.RATE_LIMIT_WINDOW} seconds.`,
            error: "Too Many Requests"
          },
          HttpStatus.TOO_MANY_REQUESTS
        );
      }

      // Increment counter
      const newCount = count + 1;
      await this.redis.set(key, newCount.toString(), this.RATE_LIMIT_WINDOW);

      // Add rate limit headers
      response.header("X-RateLimit-Limit", limit.toString());
      response.header("X-RateLimit-Remaining", Math.max(0, limit - newCount).toString());
      response.header("X-RateLimit-Reset", (Date.now() + this.RATE_LIMIT_WINDOW * 1000).toString());

      return true;
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      // If Redis error, log and continue (fail open)
      console.error(`Rate limit check error: ${error.message}`);
      return true;
    }
  }
}
