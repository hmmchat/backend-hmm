import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { createClient, type RedisClientType } from "redis";

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: RedisClientType | null = null;
  private ready = false;

  async onModuleInit() {
    const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
    try {
      this.client = createClient({ url: redisUrl });
      this.client.on("error", (err) => {
        this.ready = false;
        this.logger.error(`Redis error: ${err.message}`);
      });
      this.client.on("ready", () => {
        this.ready = true;
        this.logger.log("Redis ready");
      });
      await this.client.connect();
      this.ready = true;
    } catch (err) {
      this.ready = false;
      this.client = null;
      this.logger.error(
        `Failed to connect to Redis (${redisUrl}): ${(err as Error).message}`
      );
    }
  }

  async onModuleDestroy() {
    if (!this.client) return;
    try {
      await this.client.quit();
    } catch {
      // ignore shutdown errors
    }
    this.client = null;
    this.ready = false;
  }

  isAvailable(): boolean {
    return this.ready && this.client !== null;
  }

  async get(key: string): Promise<string | null> {
    if (!this.isAvailable() || !this.client) return null;
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (!this.isAvailable() || !this.client) {
      throw new Error("Redis unavailable");
    }
    await this.client.setEx(key, ttlSeconds, value);
  }

  /** SET key value EX ttl NX — returns true if key was set. */
  async setNx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (!this.isAvailable() || !this.client) {
      throw new Error("Redis unavailable");
    }
    const result = await this.client.set(key, value, { EX: ttlSeconds, NX: true });
    return result === "OK";
  }

  async del(key: string): Promise<void> {
    if (!this.isAvailable() || !this.client) return;
    await this.client.del(key);
  }

  async incr(key: string): Promise<number> {
    if (!this.isAvailable() || !this.client) {
      throw new Error("Redis unavailable");
    }
    return this.client.incr(key);
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    if (!this.isAvailable() || !this.client) return;
    await this.client.expire(key, ttlSeconds);
  }

  async ttl(key: string): Promise<number> {
    if (!this.isAvailable() || !this.client) return -2;
    return this.client.ttl(key);
  }
}
