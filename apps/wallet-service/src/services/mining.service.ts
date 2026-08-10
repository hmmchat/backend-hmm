import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { WalletService } from "./wallet.service.js";

export type CoinMiningBucket = "BROADCAST" | "VIDEO_CALL" | "VIEWER";

type MiningConfig = {
  thresholdSeconds: number;
  broadcastReward: number;
  videoCallReward: number;
  viewerReward: number;
  faceCardReward: number;
  referralReward: number;
  tickMs: number;
};

@Injectable()
export class MiningService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MiningService.name);
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService
  ) {}

  onModuleInit() {
    const { tickMs } = this.getConfig();
    this.tickTimer = setInterval(() => {
      this.settleAllActive().catch((err) => {
        this.logger.warn(`Mining tick failed: ${err instanceof Error ? err.message : err}`);
      });
    }, tickMs);
    if (typeof this.tickTimer.unref === "function") {
      this.tickTimer.unref();
    }
    this.logger.log(`Coin mining tick started (every ${tickMs}ms)`);
  }

  onModuleDestroy() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private getConfig(): MiningConfig {
    const parsePositive = (raw: string | undefined, fallback: number) => {
      const n = parseInt(raw || "", 10);
      return Number.isFinite(n) && n > 0 ? n : fallback;
    };
    const thresholdMinutes = parsePositive(process.env.COIN_MINING_THRESHOLD_MINUTES, 15);
    return {
      thresholdSeconds: thresholdMinutes * 60,
      broadcastReward: parsePositive(process.env.COIN_MINING_BROADCAST_REWARD, 15),
      videoCallReward: parsePositive(process.env.COIN_MINING_VIDEO_CALL_REWARD, 10),
      viewerReward: parsePositive(process.env.COIN_MINING_VIEWER_REWARD, 5),
      faceCardReward: parsePositive(process.env.COIN_MINING_FACECARD_REWARD, 10),
      referralReward: parsePositive(process.env.COIN_MINING_REFERRAL_REWARD, 20),
      tickMs: parsePositive(process.env.COIN_MINING_TICK_MS, 30000)
    };
  }

  private rewardForBucket(bucket: CoinMiningBucket, cfg: MiningConfig): number {
    switch (bucket) {
      case "BROADCAST":
        return cfg.broadcastReward;
      case "VIDEO_CALL":
        return cfg.videoCallReward;
      case "VIEWER":
        return cfg.viewerReward;
      default:
        return 0;
    }
  }

  private remainderField(
    bucket: CoinMiningBucket
  ): "broadcastRemainderSeconds" | "videoCallRemainderSeconds" | "viewerRemainderSeconds" {
    switch (bucket) {
      case "BROADCAST":
        return "broadcastRemainderSeconds";
      case "VIDEO_CALL":
        return "videoCallRemainderSeconds";
      case "VIEWER":
        return "viewerRemainderSeconds";
    }
  }

  private bucketLabel(bucket: CoinMiningBucket): string {
    switch (bucket) {
      case "BROADCAST":
        return "broadcast";
      case "VIDEO_CALL":
        return "video call";
      case "VIEWER":
        return "viewer";
    }
  }

  private async ensureProgress(userId: string) {
    return this.prisma.userCoinMiningProgress.upsert({
      where: { userId },
      create: { userId },
      update: {}
    });
  }

  private async ensureAnalyticsRow() {
    return this.prisma.coinMiningAnalytics.upsert({
      where: { id: "global" },
      create: { id: "global" },
      update: {}
    });
  }

  /**
   * Best-effort counter bump — never fails the mine if analytics write fails.
   * Time buckets increment by number of threshold chunks credited.
   */
  private async incrementMineCounters(delta: {
    broadcastMines?: number;
    videoCallMines?: number;
    viewerMines?: number;
    faceCardMines?: number;
    referralMines?: number;
  }): Promise<void> {
    const data: Record<string, { increment: number }> = {};
    if (delta.broadcastMines && delta.broadcastMines > 0) {
      data.broadcastMines = { increment: delta.broadcastMines };
    }
    if (delta.videoCallMines && delta.videoCallMines > 0) {
      data.videoCallMines = { increment: delta.videoCallMines };
    }
    if (delta.viewerMines && delta.viewerMines > 0) {
      data.viewerMines = { increment: delta.viewerMines };
    }
    if (delta.faceCardMines && delta.faceCardMines > 0) {
      data.faceCardMines = { increment: delta.faceCardMines };
    }
    if (delta.referralMines && delta.referralMines > 0) {
      data.referralMines = { increment: delta.referralMines };
    }
    if (Object.keys(data).length === 0) return;

    try {
      await this.ensureAnalyticsRow();
      await this.prisma.coinMiningAnalytics.update({
        where: { id: "global" },
        data
      });
    } catch (err) {
      this.logger.warn(
        `Mining analytics increment failed: ${err instanceof Error ? err.message : err}`
      );
    }
  }

  async getAnalytics(): Promise<{
    ok: true;
    generatedAt: string;
    broadcastMines: number;
    videoCallMines: number;
    viewerMines: number;
    faceCardMines: number;
    referralMines: number;
    totalMines: number;
  }> {
    const row = await this.ensureAnalyticsRow();
    const broadcastMines = row.broadcastMines ?? 0;
    const videoCallMines = row.videoCallMines ?? 0;
    const viewerMines = row.viewerMines ?? 0;
    const faceCardMines = row.faceCardMines ?? 0;
    const referralMines = row.referralMines ?? 0;
    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      broadcastMines,
      videoCallMines,
      viewerMines,
      faceCardMines,
      referralMines,
      totalMines:
        broadcastMines + videoCallMines + viewerMines + faceCardMines + referralMines
    };
  }

  /**
   * Apply elapsed seconds into a bucket remainder and credit full thresholds.
   */
  private async applyElapsedSeconds(
    userId: string,
    bucket: CoinMiningBucket,
    elapsedSeconds: number
  ): Promise<{ coinsCredited: number; chunks: number }> {
    if (elapsedSeconds <= 0) {
      return { coinsCredited: 0, chunks: 0 };
    }

    const cfg = this.getConfig();
    const field = this.remainderField(bucket);
    const progress = await this.ensureProgress(userId);
    const previous = progress[field] ?? 0;
    const total = previous + elapsedSeconds;
    const chunks = Math.floor(total / cfg.thresholdSeconds);
    const remainder = total % cfg.thresholdSeconds;
    const rewardPerChunk = this.rewardForBucket(bucket, cfg);
    const coinsCredited = chunks * rewardPerChunk;

    await this.prisma.userCoinMiningProgress.update({
      where: { userId },
      data: { [field]: remainder }
    });

    if (coinsCredited > 0) {
      await this.walletService.addCoinsForUser(
        userId,
        coinsCredited,
        `Coin mining: ${this.bucketLabel(bucket)} (${chunks}x threshold)`
      );
      if (chunks > 0) {
        if (bucket === "BROADCAST") {
          await this.incrementMineCounters({ broadcastMines: chunks });
        } else if (bucket === "VIDEO_CALL") {
          await this.incrementMineCounters({ videoCallMines: chunks });
        } else if (bucket === "VIEWER") {
          await this.incrementMineCounters({ viewerMines: chunks });
        }
      }
    }

    return { coinsCredited, chunks };
  }

  /**
   * Settle wall-clock time for an active session without ending it.
   */
  async settleActive(userId: string): Promise<{
    settled: boolean;
    coinsCredited: number;
    bucket?: CoinMiningBucket;
  }> {
    const session = await this.prisma.coinMiningActiveSession.findUnique({
      where: { userId }
    });
    if (!session) {
      return { settled: false, coinsCredited: 0 };
    }

    const now = new Date();
    const elapsedMs = now.getTime() - session.lastSettledAt.getTime();
    const elapsedSeconds = Math.floor(elapsedMs / 1000);
    if (elapsedSeconds <= 0) {
      return { settled: true, coinsCredited: 0, bucket: session.bucket as CoinMiningBucket };
    }

    const { coinsCredited } = await this.applyElapsedSeconds(
      userId,
      session.bucket as CoinMiningBucket,
      elapsedSeconds
    );

    await this.prisma.coinMiningActiveSession.update({
      where: { userId },
      data: { lastSettledAt: now }
    });

    return {
      settled: true,
      coinsCredited,
      bucket: session.bucket as CoinMiningBucket
    };
  }

  async settleAllActive(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const sessions = await this.prisma.coinMiningActiveSession.findMany({
        select: { userId: true }
      });
      for (const s of sessions) {
        try {
          await this.settleActive(s.userId);
        } catch (err) {
          this.logger.warn(
            `Settle active mining failed for ${s.userId}: ${err instanceof Error ? err.message : err}`
          );
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  /**
   * True when a stop/start targets an older room/call than the active session.
   * Used so a late stop from call A cannot wipe call B after a fast rematch.
   */
  private isStaleRoomBinding(
    session: { roomId: string | null; sessionId: string | null },
    roomId?: string | null,
    sessionId?: string | null
  ): boolean {
    if (roomId && session.roomId && roomId !== session.roomId) return true;
    if (sessionId && session.sessionId && sessionId !== session.sessionId) return true;
    return false;
  }

  async startSession(params: {
    userId: string;
    bucket: CoinMiningBucket;
    roomId?: string | null;
    sessionId?: string | null;
  }): Promise<{
    started: boolean;
    bucket: CoinMiningBucket;
    switchedFrom?: CoinMiningBucket | null;
  }> {
    const { userId, bucket } = params;
    await this.ensureProgress(userId);

    const existing = await this.prisma.coinMiningActiveSession.findUnique({
      where: { userId }
    });

    let switchedFrom: CoinMiningBucket | null = null;

    if (existing) {
      if (existing.bucket === bucket) {
        const rebound = this.isStaleRoomBinding(
          existing,
          params.roomId,
          params.sessionId
        );
        if (!rebound) {
          // Same bucket + same room/call — refresh metadata, keep accrual clock.
          await this.prisma.coinMiningActiveSession.update({
            where: { userId },
            data: {
              roomId: params.roomId ?? existing.roomId,
              sessionId: params.sessionId ?? existing.sessionId
            }
          });
          return { started: true, bucket, switchedFrom: null };
        }

        // Same bucket but a new room/call (fast rematch): bank elapsed, rebind
        // so a late stop for the previous room cannot delete this session.
        await this.settleActive(userId);
        await this.prisma.coinMiningActiveSession.update({
          where: { userId },
          data: {
            roomId: params.roomId ?? existing.roomId,
            sessionId: params.sessionId ?? existing.sessionId,
            lastSettledAt: new Date()
          }
        });
        return { started: true, bucket, switchedFrom: null };
      }
      switchedFrom = existing.bucket as CoinMiningBucket;
      await this.stopSession({
        userId,
        bucket: switchedFrom,
        roomId: existing.roomId,
        sessionId: existing.sessionId
      });
    }

    const now = new Date();
    await this.prisma.coinMiningActiveSession.create({
      data: {
        userId,
        bucket,
        startedAt: now,
        lastSettledAt: now,
        roomId: params.roomId ?? null,
        sessionId: params.sessionId ?? null
      }
    });

    return { started: true, bucket, switchedFrom };
  }

  async stopSession(params: {
    userId: string;
    bucket?: CoinMiningBucket | null;
    roomId?: string | null;
    sessionId?: string | null;
  }): Promise<{
    stopped: boolean;
    coinsCredited: number;
    bucket?: CoinMiningBucket;
  }> {
    const session = await this.prisma.coinMiningActiveSession.findUnique({
      where: { userId: params.userId }
    });
    if (!session) {
      return { stopped: false, coinsCredited: 0 };
    }
    if (params.bucket && session.bucket !== params.bucket) {
      // Stop request for a different bucket — ignore (exclusive session is elsewhere).
      return { stopped: false, coinsCredited: 0, bucket: session.bucket as CoinMiningBucket };
    }
    if (this.isStaleRoomBinding(session, params.roomId, params.sessionId)) {
      // Active session already belongs to a newer room/call — ignore stale stop.
      return {
        stopped: false,
        coinsCredited: 0,
        bucket: session.bucket as CoinMiningBucket
      };
    }

    const settle = await this.settleActive(params.userId);

    // Re-read: a concurrent start may have rebound this user to a newer room/call.
    const current = await this.prisma.coinMiningActiveSession.findUnique({
      where: { userId: params.userId }
    });
    if (!current) {
      return {
        stopped: true,
        coinsCredited: settle.coinsCredited,
        bucket: session.bucket as CoinMiningBucket
      };
    }
    if (this.isStaleRoomBinding(current, params.roomId, params.sessionId)) {
      return {
        stopped: false,
        coinsCredited: settle.coinsCredited,
        bucket: current.bucket as CoinMiningBucket
      };
    }

    await this.prisma.coinMiningActiveSession.delete({
      where: { userId: params.userId }
    }).catch(() => undefined);

    return {
      stopped: true,
      coinsCredited: settle.coinsCredited,
      bucket: session.bucket as CoinMiningBucket
    };
  }

  /**
   * FaceCard 100% once-lifetime reward + optional referrer-only referral payout.
   */
  async awardFaceCardComplete(params: {
    userId: string;
    referrerId?: string | null;
  }): Promise<{
    faceCardAwarded: boolean;
    faceCardAlreadyAwarded: boolean;
    referralAwarded: boolean;
    referralAlreadyAwarded: boolean;
    faceCardCoins: number;
    referralCoins: number;
  }> {
    const cfg = this.getConfig();
    const { userId } = params;
    const referrerId =
      params.referrerId && params.referrerId !== userId ? params.referrerId : null;

    const progress = await this.ensureProgress(userId);
    let faceCardAwarded = false;
    let faceCardAlreadyAwarded = !!progress.faceCardRewardedAt;
    let faceCardCoins = 0;

    if (!progress.faceCardRewardedAt) {
      const updated = await this.prisma.userCoinMiningProgress.updateMany({
        where: { userId, faceCardRewardedAt: null },
        data: { faceCardRewardedAt: new Date() }
      });
      if (updated.count > 0) {
        if (cfg.faceCardReward > 0) {
          await this.walletService.addCoinsForUser(
            userId,
            cfg.faceCardReward,
            "Coin mining: FaceCard 100%"
          );
          faceCardCoins = cfg.faceCardReward;
          await this.incrementMineCounters({ faceCardMines: 1 });
        }
        faceCardAwarded = true;
        faceCardAlreadyAwarded = false;
      } else {
        faceCardAlreadyAwarded = true;
      }
    }

    let referralAwarded = false;
    let referralAlreadyAwarded = false;
    let referralCoins = 0;

    if (referrerId && cfg.referralReward > 0) {
      const existing = await this.prisma.coinMiningReferralPayout.findUnique({
        where: { referredUserId: userId }
      });
      if (existing) {
        referralAlreadyAwarded = true;
      } else {
        try {
          // Claim uniqueness first so we never double-credit on races.
          const payout = await this.prisma.coinMiningReferralPayout.create({
            data: {
              referredUserId: userId,
              referrerId,
              referrerReward: cfg.referralReward,
              referrerTransactionId: null
            }
          });
          const credit = await this.walletService.addCoinsForUser(
            referrerId,
            cfg.referralReward,
            `Coin mining: referral ${userId}`
          );
          await this.prisma.coinMiningReferralPayout.update({
            where: { id: payout.id },
            data: { referrerTransactionId: credit.transactionId }
          });
          referralAwarded = true;
          referralCoins = cfg.referralReward;
          await this.incrementMineCounters({ referralMines: 1 });
        } catch (err: any) {
          if (err?.code === "P2002") {
            referralAlreadyAwarded = true;
          } else {
            throw err;
          }
        }
      }
    }

    return {
      faceCardAwarded,
      faceCardAlreadyAwarded,
      referralAwarded,
      referralAlreadyAwarded,
      faceCardCoins,
      referralCoins
    };
  }
}
