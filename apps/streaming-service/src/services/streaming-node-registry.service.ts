import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import os from "node:os";
import { Redis } from "ioredis";

export interface StreamingNodeInfo {
  nodeId: string;
  httpUrl: string | null;
  wsUrl: string | null;
  region: string | null;
  startedAt: string;
  updatedAt: string;
}

@Injectable()
export class StreamingNodeRegistryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StreamingNodeRegistryService.name);
  private readonly redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
  private readonly redisEnabled = process.env.STREAMING_NODE_REGISTRY_ENABLED !== "false";
  private readonly heartbeatIntervalMs = this.parsePositiveInt(
    process.env.STREAMING_NODE_HEARTBEAT_INTERVAL_MS,
    5000
  );
  private readonly heartbeatTtlSeconds = this.parsePositiveInt(
    process.env.STREAMING_NODE_HEARTBEAT_TTL_SECONDS,
    20
  );
  private readonly roomAffinityTtlSeconds = this.parsePositiveInt(
    process.env.STREAMING_ROOM_AFFINITY_TTL_SECONDS,
    86400
  );
  private readonly startedAt = new Date().toISOString();
  private readonly localRoomAssignments = new Map<string, StreamingNodeInfo>();
  private client: Redis | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  readonly nodeId =
    process.env.STREAMING_NODE_ID ||
    `${os.hostname()}-${process.pid}`;
  readonly httpUrl = process.env.STREAMING_NODE_HTTP_URL || process.env.STREAMING_SERVICE_URL || null;
  readonly wsUrl = process.env.STREAMING_NODE_WS_URL || null;
  readonly region = process.env.STREAMING_NODE_REGION || process.env.KUBERNETES_NAMESPACE || null;

  async onModuleInit(): Promise<void> {
    if (!this.redisEnabled) {
      this.logger.warn("Streaming node registry Redis integration disabled; using local-only room affinity");
      return;
    }

    try {
      this.client = new Redis(this.redisUrl, {
        connectTimeout: 3000,
        maxRetriesPerRequest: 2,
        retryStrategy: (times: number) => (times > 2 ? null : 500)
      });
      this.client.on("error", (error: Error) => {
        this.logger.warn(`Redis registry error: ${error.message}`);
      });
      await this.client.ping();
      await this.registerLocalNode();
      this.heartbeatTimer = setInterval(() => {
        void this.registerLocalNode();
      }, this.heartbeatIntervalMs);
      this.logger.log(`Streaming node registry active for node ${this.nodeId}`);
    } catch (error: any) {
      this.logger.warn(`Streaming node registry unavailable (${error?.message || error}); using local-only room affinity`);
      this.client = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }

  getLocalNodeInfo(): StreamingNodeInfo {
    return {
      nodeId: this.nodeId,
      httpUrl: this.httpUrl,
      wsUrl: this.wsUrl,
      region: this.region,
      startedAt: this.startedAt,
      updatedAt: new Date().toISOString()
    };
  }

  isLocalNode(nodeId?: string | null): boolean {
    return Boolean(nodeId) && nodeId === this.nodeId;
  }

  async assignRoomToLocalNode(roomId: string): Promise<StreamingNodeInfo> {
    const nodeInfo = this.getLocalNodeInfo();
    this.localRoomAssignments.set(roomId, nodeInfo);
    if (!this.client) {
      return nodeInfo;
    }

    try {
      await this.client.set(
        this.roomKey(roomId),
        JSON.stringify(nodeInfo),
        "EX",
        this.roomAffinityTtlSeconds
      );
    } catch (error: any) {
      this.logger.warn(`Failed to persist room affinity for ${roomId}: ${error?.message || error}`);
    }
    return nodeInfo;
  }

  async getRoomNode(roomId: string): Promise<StreamingNodeInfo | null> {
    const local = this.localRoomAssignments.get(roomId);
    if (local) return local;
    if (!this.client) return null;

    try {
      const raw = await this.client.get(this.roomKey(roomId));
      if (!raw) return null;
      return JSON.parse(raw) as StreamingNodeInfo;
    } catch (error: any) {
      this.logger.warn(`Failed to read room affinity for ${roomId}: ${error?.message || error}`);
      return null;
    }
  }

  async removeRoom(roomId: string): Promise<void> {
    this.localRoomAssignments.delete(roomId);
    if (!this.client) return;
    try {
      await this.client.del(this.roomKey(roomId));
    } catch (error: any) {
      this.logger.warn(`Failed to remove room affinity for ${roomId}: ${error?.message || error}`);
    }
  }

  async listKnownNodes(): Promise<StreamingNodeInfo[]> {
    const nodes = new Map<string, StreamingNodeInfo>();
    nodes.set(this.nodeId, this.getLocalNodeInfo());
    if (!this.client) return Array.from(nodes.values());

    try {
      const keys = await this.client.keys("streaming:nodes:*");
      if (keys.length === 0) return Array.from(nodes.values());
      const values = await this.client.mget(keys);
      for (const raw of values) {
        if (!raw) continue;
        const node = JSON.parse(raw) as StreamingNodeInfo;
        nodes.set(node.nodeId, node);
      }
    } catch (error: any) {
      this.logger.warn(`Failed to list streaming nodes: ${error?.message || error}`);
    }
    return Array.from(nodes.values());
  }

  private async registerLocalNode(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.set(
        this.nodeKey(this.nodeId),
        JSON.stringify(this.getLocalNodeInfo()),
        "EX",
        this.heartbeatTtlSeconds
      );
    } catch (error: any) {
      this.logger.warn(`Failed to heartbeat streaming node ${this.nodeId}: ${error?.message || error}`);
    }
  }

  private nodeKey(nodeId: string): string {
    return `streaming:nodes:${nodeId}`;
  }

  private roomKey(roomId: string): string {
    return `streaming:rooms:${roomId}:node`;
  }

  private parsePositiveInt(raw: string | undefined, fallback: number): number {
    const parsed = raw !== undefined && raw !== "" ? Number.parseInt(raw, 10) : fallback;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
