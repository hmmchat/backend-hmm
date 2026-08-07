import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Redis } from "ioredis";
import { RedisService } from "./redis.service.js";

type WsConn = { ws: any; userId: string };

type FanoutPayload = {
  instanceId: string;
  userId?: string;
  broadcast?: boolean;
  type: string;
  data: any;
};

const FRIEND_EVENTS_CHANNEL = "friend:events";

@Injectable()
export class MessagingRealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MessagingRealtimeService.name);
  private connsByUser = new Map<string, Set<any>>();
  private readonly instanceId = randomUUID();
  private subscriber: Redis | null = null;

  constructor(private readonly redis: RedisService) {}

  async onModuleInit() {
    if (!this.redis.isAvailable()) {
      this.logger.warn("Redis unavailable — WS fan-out limited to this instance");
      return;
    }

    try {
      const base = this.redis.getClient();
      if (!base) return;
      this.subscriber = base.duplicate();
      this.subscriber.on("error", (err: Error) => {
        this.logger.error(`Redis subscriber error: ${err.message}`);
      });
      await this.subscriber.subscribe(FRIEND_EVENTS_CHANNEL);
      this.subscriber.on("message", (_channel: string, message: string) => {
        this.handleFanoutMessage(message);
      });
      this.logger.log(`Subscribed to ${FRIEND_EVENTS_CHANNEL} (instance ${this.instanceId})`);
    } catch (error: any) {
      this.logger.error(`Failed to subscribe for WS fan-out: ${error.message}`);
    }
  }

  async onModuleDestroy() {
    if (this.subscriber) {
      try {
        await this.subscriber.unsubscribe(FRIEND_EVENTS_CHANNEL);
        await this.subscriber.quit();
      } catch {
        // ignore
      }
      this.subscriber = null;
    }
  }

  register(conn: WsConn) {
    const set = this.connsByUser.get(conn.userId) ?? new Set<any>();
    set.add(conn.ws);
    this.connsByUser.set(conn.userId, set);
  }

  unregister(conn: WsConn) {
    const set = this.connsByUser.get(conn.userId);
    if (!set) return;
    set.delete(conn.ws);
    if (set.size === 0) this.connsByUser.delete(conn.userId);
  }

  private localEmitToUser(userId: string, type: string, data: any) {
    const set = this.connsByUser.get(userId);
    if (!set || set.size === 0) return;
    const msg = JSON.stringify({ type, data });
    for (const ws of set) {
      try {
        ws.send(msg);
      } catch {
        // ignore broken sockets
      }
    }
  }

  private localBroadcast(type: string, data: any) {
    const msg = JSON.stringify({ type, data });
    for (const set of this.connsByUser.values()) {
      for (const ws of set) {
        try {
          ws.send(msg);
        } catch {
          // ignore
        }
      }
    }
  }

  private publishFanout(payload: FanoutPayload) {
    const client = this.redis.getClient();
    if (!client || !this.redis.isAvailable()) return;
    client.publish(FRIEND_EVENTS_CHANNEL, JSON.stringify(payload)).catch((err: Error) => {
      this.logger.warn(`Redis publish failed: ${err.message}`);
    });
  }

  private handleFanoutMessage(message: string) {
    try {
      const payload = JSON.parse(message) as FanoutPayload;
      if (!payload || payload.instanceId === this.instanceId) return;
      if (payload.broadcast) {
        this.localBroadcast(payload.type, payload.data);
        return;
      }
      if (payload.userId) {
        this.localEmitToUser(payload.userId, payload.type, payload.data);
      }
    } catch {
      // ignore malformed
    }
  }

  emitToUser(userId: string, type: string, data: any) {
    this.localEmitToUser(userId, type, data);
    this.publishFanout({
      instanceId: this.instanceId,
      userId,
      type,
      data
    });
  }

  /** Notify all currently connected users on every friend-service instance. */
  emitBroadcast(type: string, data: any) {
    this.localBroadcast(type, data);
    this.publishFanout({
      instanceId: this.instanceId,
      broadcast: true,
      type,
      data
    });
  }
}
