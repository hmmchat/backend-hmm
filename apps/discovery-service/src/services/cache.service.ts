import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { createClient, RedisClientType } from "redis";

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private client: RedisClientType | null = null;
  private isConnected = false;

  async onModuleInit() {
    try {
      const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
      this.client = createClient({ url: redisUrl });

      this.client.on("error", (err) => {
        console.error("[CACHE] Redis Client Error:", err);
        this.isConnected = false;
      });

      this.client.on("connect", () => {
        console.log("[CACHE] Redis Client Connecting...");
      });

      this.client.on("ready", () => {
        console.log("[CACHE] Redis Client Ready");
        this.isConnected = true;
      });

      await this.client.connect();
    } catch (error) {
      console.error("[CACHE] Failed to connect to Redis:", error);
      console.warn("[CACHE] Continuing without cache - system will still work but may be slower");
      this.isConnected = false;
    }
  }

  async onModuleDestroy() {
    if (this.client && this.isConnected) {
      try {
        await this.client.quit();
        console.log("[CACHE] Redis Client Disconnected");
      } catch (error) {
        console.error("[CACHE] Error disconnecting Redis:", error);
      }
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.client || !this.isConnected) {
      return null; // Cache unavailable, return null (cache miss)
    }

    try {
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error(`[CACHE] Error getting key ${key}:`, error);
      return null; // Return null on error (cache miss)
    }
  }

  async set(key: string, value: any, ttlSeconds: number): Promise<void> {
    if (!this.client || !this.isConnected) {
      return; // Cache unavailable, silently fail
    }

    try {
      await this.client.setEx(key, ttlSeconds, JSON.stringify(value));
    } catch (error) {
      console.error(`[CACHE] Error setting key ${key}:`, error);
      // Silently fail - cache is optional
    }
  }

  async del(key: string): Promise<void> {
    if (!this.client || !this.isConnected) {
      return; // Cache unavailable, silently fail
    }

    try {
      await this.client.del(key);
    } catch (error) {
      console.error(`[CACHE] Error deleting key ${key}:`, error);
      // Silently fail - cache is optional
    }
  }

  async delPattern(pattern: string): Promise<void> {
    if (!this.client || !this.isConnected) {
      return; // Cache unavailable, silently fail
    }

    try {
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(keys);
      }
    } catch (error) {
      console.error(`[CACHE] Error deleting pattern ${pattern}:`, error);
      // Silently fail - cache is optional
    }
  }

  /**
   * Check if cache is available
   */
  isAvailable(): boolean {
    return this.isConnected && this.client !== null;
  }

  /**
   * Get Redis client (for health checks)
   */
  getClient(): RedisClientType | null {
    return this.client;
  }
}

