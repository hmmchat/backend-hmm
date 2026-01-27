import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from "@nestjs/common";
import { RedisService } from "../services/redis.service.js";

@Injectable()
export class ConversationRateLimitGuard implements CanActivate {
  private readonly CONVERSATION_RATE_LIMIT = parseInt(process.env.CONVERSATION_RATE_LIMIT || "30", 10);
  private readonly RATE_LIMIT_WINDOW = parseInt(process.env.CONVERSATION_RATE_LIMIT_WINDOW || "60", 10);

  constructor(private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    // Only apply to GET requests for conversations
    if (request.method !== "GET" || !request.url.includes("/conversations")) {
      return true;
    }

    // Extract userId from request
    const userId = (request as any).user?.sub || (request as any).userId;
    if (!userId) {
      return true; // Skip rate limiting if no user ID
    }

    const key = `rate_limit:conversations:${userId}`;

    if (!this.redis.isAvailable()) {
      console.warn("Redis not available, skipping conversation rate limiting");
      return true;
    }

    try {
      const current = await this.redis.get(key);
      const count = current ? parseInt(current, 10) : 0;

      if (count >= this.CONVERSATION_RATE_LIMIT) {
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: `Rate limit exceeded. Maximum ${this.CONVERSATION_RATE_LIMIT} conversation requests per ${this.RATE_LIMIT_WINDOW} seconds.`,
            error: "Too Many Requests"
          },
          HttpStatus.TOO_MANY_REQUESTS
        );
      }

      const newCount = count + 1;
      await this.redis.set(key, newCount.toString(), this.RATE_LIMIT_WINDOW);

      response.header("X-RateLimit-Limit", this.CONVERSATION_RATE_LIMIT.toString());
      response.header("X-RateLimit-Remaining", Math.max(0, this.CONVERSATION_RATE_LIMIT - newCount).toString());
      response.header("X-RateLimit-Reset", (Date.now() + this.RATE_LIMIT_WINDOW * 1000).toString());

      return true;
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      console.error(`Conversation rate limit check error: ${error.message}`);
      return true;
    }
  }
}
