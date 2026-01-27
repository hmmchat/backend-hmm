import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from "@nestjs/common";
import { RedisService } from "../services/redis.service.js";

@Injectable()
export class NotificationRateLimitGuard implements CanActivate {
  private readonly NOTIFICATION_RATE_LIMIT = parseInt(process.env.NOTIFICATION_RATE_LIMIT || "60", 10); // 60 requests
  private readonly RATE_LIMIT_WINDOW = parseInt(process.env.NOTIFICATION_RATE_LIMIT_WINDOW || "60", 10); // per 60 seconds

  constructor(private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    // Only apply to GET requests for notifications
    if (request.method !== "GET" || !request.url.includes("/notifications")) {
      return true;
    }

    // Extract userId from token (we'll need to get it from the controller)
    // For now, we'll use IP as fallback
    const ip = request.ip || request.headers["x-forwarded-for"] || "unknown";
    const key = `rate_limit:notifications:${ip}`;

    if (!this.redis.isAvailable()) {
      // If Redis is not available, skip rate limiting (log warning)
      return true;
    }

    try {
      const current = await this.redis.get(key);
      const count = current ? parseInt(current, 10) : 0;

      if (count >= this.NOTIFICATION_RATE_LIMIT) {
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: `Rate limit exceeded. Maximum ${this.NOTIFICATION_RATE_LIMIT} notification requests per ${this.RATE_LIMIT_WINDOW} seconds.`,
            error: "Too Many Requests"
          },
          HttpStatus.TOO_MANY_REQUESTS
        );
      }

      // Increment counter
      const newCount = count + 1;
      await this.redis.set(key, newCount.toString(), this.RATE_LIMIT_WINDOW);

      // Add rate limit headers
      response.header("X-RateLimit-Limit", this.NOTIFICATION_RATE_LIMIT.toString());
      response.header("X-RateLimit-Remaining", Math.max(0, this.NOTIFICATION_RATE_LIMIT - newCount).toString());
      response.header("X-RateLimit-Reset", (Date.now() + this.RATE_LIMIT_WINDOW * 1000).toString());

      return true;
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      // If Redis error, log and continue (fail open)
      return true;
    }
  }
}
