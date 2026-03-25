import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { WebSocketServer } from "ws";
import { WsAuthService } from "../services/ws-auth.service.js";
import { MessagingRealtimeService } from "../services/messaging-realtime.service.js";

@Injectable()
export class MessagingGateway implements OnModuleInit {
  private readonly logger = new Logger(MessagingGateway.name);

  constructor(
    private readonly wsAuth: WsAuthService,
    private readonly realtime: MessagingRealtimeService
  ) { }

  async onModuleInit() {
    // no-op: JWT verifier is lazy inside WsAuthService
  }

  initialize(wss: WebSocketServer) {
    wss.on("connection", (ws: any, req: any) => {
      const url = req?.url || "";
      if (!url.includes("/friends/ws")) {
        ws.close(1008, "Invalid path");
        return;
      }
      void this.handleConnection(ws, req).catch(() => {
        try {
          ws.close();
        } catch { }
      });
    });
    this.logger.log("WebSocket gateway initialized at /friends/ws");
  }

  private async handleConnection(ws: any, req: any) {
    const urlString = req?.url || "";
    const token = this.extractTokenFromUrl(urlString);
    let userId: string;
    try {
      userId = await this.wsAuth.verifyAndGetUserId(token || "");
    } catch {
      ws.send(JSON.stringify({ type: "ws:ready", data: { ok: false } }));
      ws.close();
      return;
    }

    (ws as any).__userId = userId;
    this.realtime.register({ ws, userId });
    ws.send(JSON.stringify({ type: "ws:ready", data: { ok: true, userId } }));

    ws.on("close", () => {
      this.realtime.unregister({ ws, userId });
    });

    ws.on("error", () => {
      this.realtime.unregister({ ws, userId });
    });
  }

  private extractTokenFromUrl(url: string): string | null {
    try {
      const qs = url.includes("?") ? url.split("?")[1] : "";
      const params = new URLSearchParams(qs);
      return params.get("token");
    } catch {
      const match = url.match(/[?&]token=([^&]*)/);
      return match ? decodeURIComponent(match[1]) : null;
    }
  }
}

