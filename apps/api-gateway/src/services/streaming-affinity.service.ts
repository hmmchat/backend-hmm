import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, RedisClientType } from "redis";

export interface StreamingNodeInfo {
  nodeId: string;
  httpUrl: string | null;
  wsUrl: string | null;
  region: string | null;
  startedAt: string;
  updatedAt: string;
}

@Injectable()
export class StreamingAffinityService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StreamingAffinityService.name);
  private client: RedisClientType | null = null;
  private enabled = false;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    if (this.configService.get<string>("STREAMING_AFFINITY_ENABLED") === "false") {
      this.logger.warn("Streaming affinity routing disabled");
      return;
    }

    const redisUrl = this.configService.get<string>("REDIS_URL");
    if (!redisUrl) {
      this.logger.warn("REDIS_URL not configured; streaming affinity routing will use default streaming URL");
      return;
    }

    try {
      this.client = createClient({ url: redisUrl });
      this.client.on("error", (error) => {
        this.logger.warn(`Redis affinity error: ${error.message}`);
      });
      await this.client.connect();
      this.enabled = true;
      this.logger.log("Streaming affinity routing enabled");
    } catch (error: any) {
      this.enabled = false;
      this.client = null;
      this.logger.warn(`Streaming affinity Redis unavailable: ${error?.message || error}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }

  async getRoomNode(roomId: string): Promise<StreamingNodeInfo | null> {
    if (!this.enabled || !this.client) return null;
    try {
      const raw = await this.client.get(this.roomKey(roomId));
      if (!raw) return null;
      return JSON.parse(String(raw)) as StreamingNodeInfo;
    } catch (error: any) {
      this.logger.warn(`Failed to read streaming affinity for room ${roomId}: ${error?.message || error}`);
      return null;
    }
  }

  private roomKey(roomId: string): string {
    return `streaming:rooms:${roomId}:node`;
  }
}
