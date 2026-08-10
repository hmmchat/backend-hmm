import { Injectable, Logger } from "@nestjs/common";
import { WalletClientService } from "./wallet-client.service.js";

export type MiningBucket = "BROADCAST" | "VIDEO_CALL" | "VIEWER";

type MiningMeta = { roomId?: string | null; sessionId?: string | null };

@Injectable()
export class CoinMiningProgressService {
  private readonly logger = new Logger(CoinMiningProgressService.name);

  constructor(private readonly walletClient: WalletClientService) {}

  start(
    userId: string,
    bucket: MiningBucket,
    meta?: MiningMeta
  ): void {
    if (!userId || userId.startsWith("anonymous:")) return;
    this.walletClient
      .startMiningSession({
        userId,
        bucket,
        roomId: meta?.roomId ?? null,
        sessionId: meta?.sessionId ?? null
      })
      .catch((err) => {
        this.logger.warn(
          `Mining start failed for ${userId}/${bucket}: ${err?.message || err}`
        );
      });
  }

  stop(userId: string, bucket?: MiningBucket | null, meta?: MiningMeta): void {
    if (!userId || userId.startsWith("anonymous:")) return;
    this.walletClient
      .stopMiningSession({
        userId,
        bucket: bucket ?? null,
        roomId: meta?.roomId ?? null,
        sessionId: meta?.sessionId ?? null
      })
      .catch((err) => {
        this.logger.warn(
          `Mining stop failed for ${userId}: ${err?.message || err}`
        );
      });
  }

  startMany(
    userIds: string[],
    bucket: MiningBucket,
    meta?: MiningMeta
  ): void {
    for (const userId of userIds) {
      this.start(userId, bucket, meta);
    }
  }

  stopMany(
    userIds: string[],
    bucket?: MiningBucket | null,
    meta?: MiningMeta
  ): void {
    for (const userId of userIds) {
      this.stop(userId, bucket, meta);
    }
  }

  /** Participant earning bucket from broadcast flag. */
  participantBucket(isBroadcasting: boolean): MiningBucket {
    return isBroadcasting ? "BROADCAST" : "VIDEO_CALL";
  }
}
