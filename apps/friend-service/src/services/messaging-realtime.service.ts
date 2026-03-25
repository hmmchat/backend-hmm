import { Injectable } from "@nestjs/common";

type WsConn = { ws: any; userId: string };

@Injectable()
export class MessagingRealtimeService {
  private connsByUser = new Map<string, Set<any>>();

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

  emitToUser(userId: string, type: string, data: any) {
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
}

