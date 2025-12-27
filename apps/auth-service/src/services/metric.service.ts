import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { createClient, RedisClientType } from "redis";

@Injectable()
export class MetricService implements OnModuleInit, OnModuleDestroy {
  private client!: RedisClientType;

  async onModuleInit() {
    this.client = createClient({
      url: process.env.REDIS_URL || "redis://localhost:6379"
    });

    this.client.on("error", err => {
      console.error("Redis error:", err);
    });

    await this.client.connect();
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  async incrementMeetings(): Promise<number> {
    const count = await this.client.incr("meetings:count");
    return Number(count);
  }

  async getMeetingsCount(): Promise<number> {
    const val = await this.client.get("meetings:count");
    return val ? Number(val) : 0;
  }
}
