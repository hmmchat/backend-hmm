import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { WalletClientService } from "./wallet-client.service.js";

type Interval = { start: number; end: number };

@Injectable()
export class SeasonProgressService {
  private readonly logger = new Logger(SeasonProgressService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletClient: WalletClientService
  ) {}

  /**
   * After a participant joins: record peer edges with every other active participant.
   */
  async onParticipantJoined(sessionId: string, userId: string): Promise<void> {
    try {
      const others = await this.prisma.callParticipant.findMany({
        where: {
          sessionId,
          status: "active",
          leftAt: null,
          userId: { not: userId }
        },
        select: { userId: true }
      });

      const pairs: Array<{ userId: string; peerUserId: string }> = [];
      for (const o of others) {
        pairs.push({ userId, peerUserId: o.userId });
        pairs.push({ userId: o.userId, peerUserId: userId });
      }
      if (pairs.length) {
        await this.walletClient.recordSeasonPeerPairs(pairs);
      }
    } catch (error: any) {
      this.logger.warn(
        `onParticipantJoined season progress failed: ${error?.message || error}`
      );
    }
  }

  /**
   * At room end: finalize peer edges + credit beam/beamcast seconds per participant.
   */
  async onRoomEnded(sessionId: string, roomId: string): Promise<void> {
    try {
      const session = await this.prisma.callSession.findUnique({
        where: { id: sessionId }
      });
      if (!session) return;

      const endedAt = session.endedAt || new Date();
      const participants = await this.prisma.callParticipant.findMany({
        where: { sessionId },
        select: { userId: true, joinedAt: true, leftAt: true }
      });

      if (participants.length < 1) return;

      // Peer edges for everyone who co-participated (not viewers)
      const pairs: Array<{ userId: string; peerUserId: string }> = [];
      for (let i = 0; i < participants.length; i++) {
        for (let j = i + 1; j < participants.length; j++) {
          const a = participants[i];
          const b = participants[j];
          if (this.intervalsOverlap(
            a.joinedAt.getTime(),
            (a.leftAt || endedAt).getTime(),
            b.joinedAt.getTime(),
            (b.leftAt || endedAt).getTime()
          )) {
            pairs.push({ userId: a.userId, peerUserId: b.userId });
            pairs.push({ userId: b.userId, peerUserId: a.userId });
          }
        }
      }
      if (pairs.length) {
        await this.walletClient.recordSeasonPeerPairs(pairs);
      }

      const broadcastIntervals = await this.getBroadcastIntervals(sessionId, endedAt);

      for (const p of participants) {
        const joinMs = p.joinedAt.getTime();
        const leaveMs = (p.leftAt || endedAt).getTime();
        if (leaveMs <= joinMs) continue;

        const presence: Interval = { start: joinMs, end: leaveMs };
        const beamcastMs = this.overlapDurationMs(presence, broadcastIntervals);
        const totalMs = leaveMs - joinMs;
        const beamMs = Math.max(0, totalMs - beamcastMs);

        const beamSeconds = Math.floor(beamMs / 1000);
        const beamcastSeconds = Math.floor(beamcastMs / 1000);
        if (beamSeconds === 0 && beamcastSeconds === 0) continue;

        await this.walletClient.creditSeasonCallTime({
          userId: p.userId,
          beamSeconds,
          beamcastSeconds,
          eventKey: `session:${sessionId}:user:${p.userId}`
        });
      }

      this.logger.log(
        `Season progress reported for room ${roomId} session ${sessionId} (${participants.length} participants)`
      );
    } catch (error: any) {
      this.logger.warn(`onRoomEnded season progress failed: ${error?.message || error}`);
    }
  }

  /**
   * Best-effort backfill of lifetime peers from historical CallParticipant co-presence.
   */
  async backfillPeersFromHistory(limitSessions = 5000): Promise<{ pairs: number }> {
    const sessions = await this.prisma.callSession.findMany({
      where: { status: "ENDED" },
      orderBy: { endedAt: "desc" },
      take: limitSessions,
      select: { id: true, endedAt: true }
    });

    const pairSet = new Set<string>();
    const pairs: Array<{ userId: string; peerUserId: string }> = [];

    for (const s of sessions) {
      const parts = await this.prisma.callParticipant.findMany({
        where: { sessionId: s.id },
        select: { userId: true }
      });
      for (let i = 0; i < parts.length; i++) {
        for (let j = i + 1; j < parts.length; j++) {
          const a = parts[i].userId;
          const b = parts[j].userId;
          const k1 = `${a}|${b}`;
          const k2 = `${b}|${a}`;
          if (!pairSet.has(k1)) {
            pairSet.add(k1);
            pairs.push({ userId: a, peerUserId: b });
          }
          if (!pairSet.has(k2)) {
            pairSet.add(k2);
            pairs.push({ userId: b, peerUserId: a });
          }
        }
      }
    }

    // Batch to wallet
    const chunk = 200;
    for (let i = 0; i < pairs.length; i += chunk) {
      await this.walletClient.recordSeasonPeerPairs(pairs.slice(i, i + chunk));
    }
    return { pairs: pairs.length };
  }

  private async getBroadcastIntervals(
    sessionId: string,
    endedAt: Date
  ): Promise<Interval[]> {
    const events = await this.prisma.callEvent.findMany({
      where: {
        sessionId,
        eventType: { in: ["broadcast_started", "broadcast_stopped", "broadcast_ended"] }
      },
      orderBy: { createdAt: "asc" },
      select: { eventType: true, createdAt: true }
    });

    const intervals: Interval[] = [];
    let openStart: number | null = null;
    for (const e of events) {
      if (e.eventType === "broadcast_started") {
        openStart = e.createdAt.getTime();
      } else if (
        (e.eventType === "broadcast_stopped" || e.eventType === "broadcast_ended") &&
        openStart !== null
      ) {
        intervals.push({ start: openStart, end: e.createdAt.getTime() });
        openStart = null;
      }
    }
    if (openStart !== null) {
      intervals.push({ start: openStart, end: endedAt.getTime() });
    }
    return intervals;
  }

  private intervalsOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
    return a0 < b1 && b0 < a1;
  }

  private overlapDurationMs(presence: Interval, blocks: Interval[]): number {
    let total = 0;
    for (const b of blocks) {
      const start = Math.max(presence.start, b.start);
      const end = Math.min(presence.end, b.end);
      if (end > start) total += end - start;
    }
    return total;
  }
}
