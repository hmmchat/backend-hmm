import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

export type DiscoverySessionIntent = "solo" | "pull_stranger_host";

@Injectable()
export class DiscoverySessionService {
  private readonly logger = new Logger(DiscoverySessionService.name);
  private readonly sessionTtlMs: number;

  constructor(private readonly prisma: PrismaService) {
    this.sessionTtlMs = parseInt(process.env.DISCOVERY_SESSION_TTL_MS || "90000", 10);
  }

  private get expiresAt(): Date {
    return new Date(Date.now() + this.sessionTtlMs);
  }

  async upsertSession(
    userId: string,
    sessionId: string,
    intent: DiscoverySessionIntent = "solo"
  ): Promise<void> {
    const now = new Date();
    await (this.prisma as any).discoverySession.upsert({
      where: { userId },
      create: {
        userId,
        sessionId,
        intent,
        lastHeartbeat: now,
        expiresAt: this.expiresAt
      },
      update: {
        sessionId,
        intent,
        lastHeartbeat: now,
        expiresAt: this.expiresAt
      }
    });
  }

  async heartbeat(userId: string, sessionId?: string): Promise<boolean> {
    const row = await (this.prisma as any).discoverySession.findUnique({
      where: { userId }
    });
    if (!row) {
      return false;
    }
    if (sessionId && row.sessionId !== sessionId) {
      return false;
    }
    if (row.expiresAt <= new Date()) {
      return false;
    }

    await (this.prisma as any).discoverySession.update({
      where: { userId },
      data: {
        lastHeartbeat: new Date(),
        expiresAt: this.expiresAt
      }
    });
    return true;
  }

  async clearSession(userId: string): Promise<void> {
    try {
      await (this.prisma as any).discoverySession.deleteMany({
        where: { userId }
      });
    } catch (error: any) {
      this.logger.warn(`Failed to clear discovery session for ${userId}: ${error?.message || error}`);
    }
  }

  async hasActiveSession(userId: string): Promise<boolean> {
    const row = await (this.prisma as any).discoverySession.findUnique({
      where: { userId }
    });
    return Boolean(row && row.expiresAt > new Date());
  }

  async filterSoloPoolCandidates<T extends { id: string; status?: string }>(users: T[]): Promise<T[]> {
    if (users.length === 0) {
      return users;
    }

    const soloIds = users
      .filter((u) => String(u.status || "AVAILABLE") === "AVAILABLE")
      .map((u) => u.id);
    if (soloIds.length === 0) {
      return users;
    }

    const activeRows = await (this.prisma as any).discoverySession.findMany({
      where: {
        userId: { in: soloIds },
        expiresAt: { gt: new Date() }
      },
      select: { userId: true }
    });
    const activeSet = new Set<string>(activeRows.map((r: any) => r.userId));

    return users.filter((u) => {
      const status = String(u.status || "AVAILABLE");
      if (status !== "AVAILABLE") {
        return true;
      }
      return activeSet.has(u.id);
    });
  }

  /**
   * Expire stale sessions. Returns user IDs that should be demoted to ONLINE.
   */
  async reconcileExpiredSessions(): Promise<string[]> {
    const expired = await (this.prisma as any).discoverySession.findMany({
      where: { expiresAt: { lte: new Date() } },
      select: { userId: true }
    });

    if (!expired.length) {
      return [];
    }

    const userIds = expired.map((r: any) => r.userId);
    await (this.prisma as any).discoverySession.deleteMany({
      where: { userId: { in: userIds } }
    });

    this.logger.log(`Reconciled ${userIds.length} expired discovery session(s)`);
    return userIds;
  }

  /**
   * Users with an active solo session row (not expired).
   */
  async getActiveSessionUserIds(): Promise<Set<string>> {
    const rows = await (this.prisma as any).discoverySession.findMany({
      where: { expiresAt: { gt: new Date() } },
      select: { userId: true }
    });
    return new Set<string>(rows.map((r: any) => r.userId));
  }
}
