import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { Redis } from "ioredis";

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private readonly redisUrl: string;
  private readonly cacheEnabled: boolean;

  constructor() {
    this.redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
    this.cacheEnabled = process.env.REDIS_ENABLED !== "false"; // Default to enabled
  }

  async onModuleInit() {
    if (!this.cacheEnabled) {
      this.logger.log("Redis caching is disabled");
      return;
    }

    try {
      this.client = new Redis(this.redisUrl, {
        connectTimeout: 3000,
        retryStrategy: (times: number) => {
          if (times > 2) return null;
          return 500;
        },
        maxRetriesPerRequest: 2
      });

      this.client.on("error", (err: Error) => {
        this.logger.error(`Redis error: ${err.message}`);
      });

      this.client.on("connect", () => {
        this.logger.log("Redis connected successfully");
      });

      await this.client.ping();
      this.logger.log("Redis service initialized");
    } catch (error: any) {
      this.logger.error(`Failed to connect to Redis: ${error.message}`);
      this.logger.error(`Redis is required for friend-service. Ensure Redis is running: brew services start redis`);
      throw error;
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
      this.logger.log("Redis connection closed");
    }
  }

  /**
   * Get value from cache
   */
  async get(key: string): Promise<string | null> {
    if (!this.client || !this.cacheEnabled) {
      return null;
    }

    try {
      return await this.client.get(key);
    } catch (error: any) {
      this.logger.warn(`Redis get error for key ${key}: ${error.message}`);
      return null;
    }
  }

  /**
   * Set value in cache with TTL
   */
  async set(key: string, value: string, ttlSeconds: number = 300): Promise<void> {
    if (!this.client || !this.cacheEnabled) {
      return;
    }

    try {
      await this.client.setex(key, ttlSeconds, value);
    } catch (error: any) {
      this.logger.warn(`Redis set error for key ${key}: ${error.message}`);
    }
  }

  /**
   * Delete key from cache
   */
  async del(key: string): Promise<void> {
    if (!this.client || !this.cacheEnabled) {
      return;
    }

    try {
      await this.client.del(key);
    } catch (error: any) {
      this.logger.warn(`Redis del error for key ${key}: ${error.message}`);
    }
  }

  /**
   * Get all keys matching pattern
   */
  async keys(pattern: string): Promise<string[]> {
    if (!this.client || !this.cacheEnabled) {
      return [];
    }

    try {
      return await this.client.keys(pattern);
    } catch (error: any) {
      this.logger.warn(`Redis keys error for pattern ${pattern}: ${error.message}`);
      return [];
    }
  }

  /**
   * Delete multiple keys matching pattern
   */
  async delPattern(pattern: string): Promise<void> {
    if (!this.client || !this.cacheEnabled) {
      return;
    }

    try {
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
    } catch (error: any) {
      this.logger.warn(`Redis delPattern error for pattern ${pattern}: ${error.message}`);
    }
  }

  /**
   * Check if Redis is available
   */
  isAvailable(): boolean {
    return this.client !== null && this.cacheEnabled;
  }
  
  /**
   * Get Redis client (for health checks)
   */
  getClient(): Redis | null {
    return this.client;
  }
}
