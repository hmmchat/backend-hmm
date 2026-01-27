import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from "@nestjs/common";
import { RedisService } from "../services/redis.service.js";

@Injectable()
export class ShareRateLimitGuard implements CanActivate {
  private readonly SHARE_RATE_LIMIT = parseInt(process.env.SHARE_RATE_LIMIT || "10", 10);
  private readonly RATE_LIMIT_WINDOW = parseInt(process.env.SHARE_RATE_LIMIT_WINDOW || "60", 10);

  constructor(private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    // Extract userId from request (should be set by auth middleware/guard)
    const userId = (request as any).user?.sub || (request as any).userId;
    if (!userId) {
      return true; // Skip rate limiting if no user ID
    }

    const key = `rate_limit:share:${userId}`;

    if (!this.redis.isAvailable()) {
      // If Redis is not available, skip rate limiting (log warning)
      console.warn("Redis not available, skipping share rate limiting");
      return true;
    }

    try {
      const current = await this.redis.get(key);
      const count = current ? parseInt(current, 10) : 0;

      if (count >= this.SHARE_RATE_LIMIT) {
        const retryAfter = this.RATE_LIMIT_WINDOW;
        response.header("Retry-After", retryAfter.toString());
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: `Rate limit exceeded. Maximum ${this.SHARE_RATE_LIMIT} share requests per ${this.RATE_LIMIT_WINDOW} seconds.`,
            error: "Too Many Requests",
            retryAfter
          },
          HttpStatus.TOO_MANY_REQUESTS
        );
      }

      // Increment counter
      const newCount = count + 1;
      await this.redis.set(key, newCount.toString(), this.RATE_LIMIT_WINDOW);

      // Add rate limit headers
      response.header("X-RateLimit-Limit", this.SHARE_RATE_LIMIT.toString());
      response.header("X-RateLimit-Remaining", Math.max(0, this.SHARE_RATE_LIMIT - newCount).toString());
      response.header("X-RateLimit-Reset", (Date.now() + this.RATE_LIMIT_WINDOW * 1000).toString());

      return true;
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      // If Redis error, log and continue (fail open)
      console.error(`Share rate limit check error: ${error.message}`);
      return true;
    }
  }
}
