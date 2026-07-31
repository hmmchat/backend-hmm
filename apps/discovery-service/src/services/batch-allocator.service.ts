/**
 * Pool-wide batch allocator.
 *
 * Runs every ~2 seconds. Default MATCHING_MODE=batch_primary (full rollout).
 * Modes:
 * - batch_primary: persists matches for all cities (or optional MATCHING_CANARY_CITIES restrict)
 * - shadow: scores + logs, does not persist
 * - live_legacy: cycle skipped for allocation work
 */
import { Injectable, Logger, OnModuleInit, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { CacheService } from "./cache.service.js";
import { MatchingService } from "./matching.service.js";
import { SemanticScorerService } from "./semantic-scorer.service.js";
import { UserClientService } from "./user-client.service.js";
import { HostedEmbeddingAdapter } from "./embedding-adapters/hosted.adapter.js";
import {
  MATCHING_ALLOCATOR_INTERVAL_MS,
  MATCHING_MAX_POOL_SIZE,
  MATCHING_2OPT_ITERATIONS,
  MATCHING_FAIRNESS_WAIT_BOOST,
  MATCHING_MODE,
  MATCHING_PAUSED,
  MATCHING_CANARY_CITIES,
  MATCHING_SCORE_WEIGHTS,
  shouldAllocatorPersist,
  shouldAllocatorShadowLog,
  isBatchPrimaryForCity
} from "../config/matching-admin.config.js";
import type { SemanticProfile } from "./semantic-scorer.service.js";

interface AllocatorUser {
  userId: string;
  sessionId: string;
  city: string | null;
  semantic: SemanticProfile | null;
  fairnessCycles: number;
  raincheckedUserIds: Set<string>;
}

interface PairResult {
  user1: string;
  user2: string;
  score: number;
}

@Injectable()
export class BatchAllocatorService implements OnModuleInit {
  private readonly logger = new Logger(BatchAllocatorService.name);
  private running = false;
  private paused = false;
  private lastAllocationAt: Date | null = null;
  private lastPoolSize = 0;
  private lastShadowPairs: PairResult[] = [];
  private pairScoreMap = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly matching: MatchingService,
    private readonly semanticScorer: SemanticScorerService,
    private readonly userClient: UserClientService,
    @Optional() private readonly embeddingAdapter?: HostedEmbeddingAdapter
  ) {}

  async onModuleInit() {
    const pausedRedis = await this.cache.get<string>("matchmaking:paused");
    this.paused = pausedRedis === "true" || MATCHING_PAUSED;
    if (this.embeddingAdapter) {
      await this.embeddingAdapter.setPaused(this.paused);
    }

    const intervalMs = MATCHING_ALLOCATOR_INTERVAL_MS;
    setInterval(() => void this.runCycle(), intervalMs);
    this.logger.log(
      `Batch allocator started (interval ${intervalMs}ms, mode=${MATCHING_MODE}, paused=${this.paused})`
    );
  }

  async pause(): Promise<void> {
    this.paused = true;
    await this.cache.set("matchmaking:paused", "true", 86400 * 365);
    if (this.embeddingAdapter) await this.embeddingAdapter.setPaused(true);
    this.logger.warn("Batch allocator PAUSED via admin");
  }

  async resume(): Promise<void> {
    this.paused = false;
    await this.cache.del("matchmaking:paused");
    if (this.embeddingAdapter) await this.embeddingAdapter.setPaused(false);
    this.logger.log("Batch allocator RESUMED via admin");
  }

  isPaused(): boolean {
    return this.paused;
  }

  getState(): {
    paused: boolean;
    running: boolean;
    mode: string;
    lastAllocationAt: Date | null;
    lastPoolSize: number;
    lastShadowPairCount: number;
    canaryCities: string[];
  } {
    return {
      paused: this.paused,
      running: this.running,
      mode: MATCHING_MODE,
      lastAllocationAt: this.lastAllocationAt,
      lastPoolSize: this.lastPoolSize,
      lastShadowPairCount: this.lastShadowPairs.length,
      canaryCities: MATCHING_CANARY_CITIES
    };
  }

  getLastShadowPairs(): PairResult[] {
    return this.lastShadowPairs;
  }

  async runCycle(): Promise<void> {
    if (this.paused) return;
    if (MATCHING_MODE === "live_legacy") return;
    if (this.running) return;

    // Redis lock — do not hold a DB advisory xact lock across scoring / HTTP
    const lockKey = "matchmaking:allocator:lock";
    const existing = await this.cache.get<string>(lockKey);
    if (existing) return;
    await this.cache.set(lockKey, "1", Math.ceil(MATCHING_ALLOCATOR_INTERVAL_MS / 1000) + 5);

    this.running = true;
    try {
      this.semanticScorer.clearCache();

      const candidates = await this.buildPool();
      this.lastPoolSize = candidates.length;

      if (candidates.length < 2) {
        this.logger.debug(`Pool too small (${candidates.length}), skipping allocation`);
        return;
      }

      // Canary: only keep users whose city is in batch_primary canary set when configured
      const eligible =
        MATCHING_MODE === "batch_primary" && MATCHING_CANARY_CITIES.length > 0
          ? candidates.filter((u) => isBatchPrimaryForCity(u.city))
          : candidates;

      if (eligible.length < 2) {
        this.logger.debug(`Eligible pool too small after canary filter (${eligible.length})`);
        return;
      }

      const pairs = await this.scorePairs(eligible);
      const matches = this.allocate(pairs);

      if (shouldAllocatorShadowLog()) {
        this.lastShadowPairs = matches;
        this.logger.log(
          `Allocator ${MATCHING_MODE}: pool=${eligible.length} pairs=${pairs.length} matches=${matches.length} top=${matches
            .slice(0, 5)
            .map((m) => `${m.user1.slice(0, 6)}-${m.user2.slice(0, 6)}:${m.score}`)
            .join(",")}`
        );
      }

      if (shouldAllocatorPersist() && MATCHING_MODE === "batch_primary") {
        for (const m of matches) {
          await this.createMatchAtomic(m.user1, m.user2, m.score);
        }
        if (matches.length > 0) {
          this.lastAllocationAt = new Date();
        }
      }
    } catch (err) {
      this.logger.error(`Allocation cycle failed: ${err}`);
    } finally {
      this.running = false;
      await this.cache.del(lockKey);
    }
  }

  private async buildPool(): Promise<AllocatorUser[]> {
    const sessions = await (this.prisma as any).discoverySession.findMany({
      where: {
        expiresAt: { gt: new Date() },
        intent: { in: ["solo", "pull_stranger_host"] }
      },
      select: { userId: true, sessionId: true }
    });

    const userIds: string[] = sessions.map((s: any) => s.userId);
    if (userIds.length === 0) return [];

    const sessionMap = new Map(sessions.map((s: any) => [s.userId, s.sessionId]));

    // Group by preferred city — fetch discovery pools per city
    const cityByUser = new Map<string, string | null>();
    await Promise.all(
      userIds.map(async (id) => {
        try {
          const city = await this.userClient.getPreferredCityById(id);
          cityByUser.set(id, city);
        } catch {
          cityByUser.set(id, null);
        }
      })
    );

    const cities = new Set<string>();
    for (const c of cityByUser.values()) {
      if (c) cities.add(c);
    }
    // Also fetch null/"anywhere" style pool once
    cities.add("__null__");

    const usersById = new Map<string, any>();
    for (const city of cities) {
      const cityFilter = city === "__null__" ? null : city;
      try {
        const users = await this.userClient.getUsersForDiscoveryById("", {
          city: cityFilter,
          statuses: ["AVAILABLE", "IN_SQUAD_AVAILABLE", "IN_BROADCAST_AVAILABLE"],
          limit: MATCHING_MAX_POOL_SIZE
        });
        for (const u of users) {
          if (userIds.includes(u.id)) usersById.set(u.id, u);
        }
      } catch (err) {
        this.logger.warn(`Failed to fetch discovery pool for city ${city}: ${err}`);
      }
    }

    const matchedIds = await this.matching.getMatchedUserIdsCached();
    const matchedSet = new Set(matchedIds);

    const rainchecks = await (this.prisma as any).raincheckSession.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, sessionId: true, raincheckedUserId: true }
    });
    const raincheckMap = new Map<string, Set<string>>();
    for (const rc of rainchecks) {
      const sessionId = sessionMap.get(rc.userId);
      if (sessionId && rc.sessionId !== sessionId) continue;
      if (!raincheckMap.has(rc.userId)) raincheckMap.set(rc.userId, new Set());
      raincheckMap.get(rc.userId)!.add(rc.raincheckedUserId);
    }

    const fairnessCounters = await this.getFairnessCounters(userIds);

    const pool: AllocatorUser[] = [];
    for (const userId of userIds) {
      if (matchedSet.has(userId)) continue;
      const u = usersById.get(userId);
      if (!u) continue;
      const sessionId = sessionMap.get(userId);
      if (!sessionId) continue;

      pool.push({
        userId,
        sessionId: sessionId as string,
        city: cityByUser.get(userId) ?? u.preferredCity ?? null,
        semantic: this.buildSemanticProfile(u),
        fairnessCycles: fairnessCounters.get(userId) || 0,
        raincheckedUserIds: raincheckMap.get(userId) || new Set()
      });

      // Increment fairness wait counter for this cycle
      await this.bumpFairnessCounter(userId);
    }

    if (pool.length > MATCHING_MAX_POOL_SIZE) {
      pool.sort((a, b) => b.fairnessCycles - a.fairnessCycles);
      return pool.slice(0, MATCHING_MAX_POOL_SIZE);
    }
    return pool;
  }

  private buildSemanticProfile(user: any): SemanticProfile | null {
    const brandIds = (user.brandPreferences || []).map((bp: any) => bp.brandId || bp.brand?.id).filter(Boolean);
    const interestIds = (user.interests || []).map((i: any) => i.interestId || i.interest?.id).filter(Boolean);
    const valueIds = (user.values || []).map((v: any) => v.valueId || v.value?.id).filter(Boolean);
    const musicPreferenceId = user.musicPreferenceId || user.musicPreference?.id || null;

    if (!user.intent && !musicPreferenceId && brandIds.length === 0 && interestIds.length === 0 && valueIds.length === 0) {
      return null;
    }

    return {
      userId: user.id,
      intent: user.intent || null,
      musicPreferenceId,
      brandIds,
      interestIds,
      valueIds,
      city: user.preferredCity || user.actualCity || null
    };
  }

  private async getFairnessCounters(userIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    for (const id of userIds) {
      const val = await this.cache.get<number>(`matchmaking:fairness:${id}`);
      if (val !== null && val !== undefined) map.set(id, val);
    }
    return map;
  }

  private async bumpFairnessCounter(userId: string): Promise<void> {
    const key = `matchmaking:fairness:${userId}`;
    const val = (await this.cache.get<number>(key)) || 0;
    await this.cache.set(key, val + 1, 600);
  }

  private async resetFairnessCounter(userId: string): Promise<void> {
    await this.cache.del(`matchmaking:fairness:${userId}`);
  }

  private pairKey(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  private async scorePairs(users: AllocatorUser[]): Promise<PairResult[]> {
    await this.semanticScorer.preloadFeatures(users.map((u) => u.userId));

    const pairs: PairResult[] = [];
    this.pairScoreMap.clear();

    for (let i = 0; i < users.length; i++) {
      for (let j = i + 1; j < users.length; j++) {
        const u1 = users[i];
        const u2 = users[j];

        if (u1.raincheckedUserIds.has(u2.userId) || u2.raincheckedUserIds.has(u1.userId)) {
          continue;
        }

        let score = 0;
        if (u1.semantic && u2.semantic) {
          score = await this.semanticScorer.score(u1.semantic, u2.semantic);
        } else {
          score =
            this.semanticScorer.fallbackIntentScore(u1.semantic?.intent || null, u2.semantic?.intent || null) *
            MATCHING_SCORE_WEIGHTS.intent;
        }

        const fairnessBoost =
          1 + Math.min(u1.fairnessCycles, u2.fairnessCycles) * MATCHING_FAIRNESS_WAIT_BOOST;
        score = Math.min(100, Math.round(score * fairnessBoost));

        if (score > 0) {
          const pair = { user1: u1.userId, user2: u2.userId, score };
          pairs.push(pair);
          this.pairScoreMap.set(this.pairKey(u1.userId, u2.userId), score);
        }
      }
    }

    pairs.sort((a, b) => b.score - a.score);
    return pairs;
  }

  /**
   * Greedy max-cardinality pairing + 2-opt local improvement using pairScoreMap.
   */
  allocate(pairs: PairResult[]): PairResult[] {
    if (pairs.length === 0) return [];

    const paired = new Set<string>();
    const matches: PairResult[] = [];

    for (const p of pairs) {
      if (paired.has(p.user1) || paired.has(p.user2)) continue;
      if (p.user1 === p.user2) continue;
      paired.add(p.user1);
      paired.add(p.user2);
      matches.push({ ...p });
    }

    for (let iter = 0; iter < MATCHING_2OPT_ITERATIONS; iter++) {
      let improved = false;
      for (let i = 0; i < matches.length; i++) {
        for (let j = i + 1; j < matches.length; j++) {
          const a = matches[i];
          const b = matches[j];
          const currentSum = a.score + b.score;

          const s11 = this.scorePair(a.user1, b.user1);
          const s22 = this.scorePair(a.user2, b.user2);
          const s12 = this.scorePair(a.user1, b.user2);
          const s21 = this.scorePair(a.user2, b.user1);

          const swap1 = s11 + s22;
          const swap2 = s12 + s21;

          if (swap1 > currentSum && s11 > 0 && s22 > 0) {
            matches[i] = { user1: a.user1, user2: b.user1, score: s11 };
            matches[j] = { user1: a.user2, user2: b.user2, score: s22 };
            improved = true;
          } else if (swap2 > currentSum && s12 > 0 && s21 > 0) {
            matches[i] = { user1: a.user1, user2: b.user2, score: s12 };
            matches[j] = { user1: a.user2, user2: b.user1, score: s21 };
            improved = true;
          }
        }
      }
      if (!improved) break;
    }

    return matches;
  }

  /** Fast score lookup for 2-opt from the precomputed pair map. */
  scorePair(u1: string, u2: string): number {
    if (u1 === u2) return 0;
    return this.pairScoreMap.get(this.pairKey(u1, u2)) || 0;
  }

  /** Expose pair map seeding for tests. */
  setPairScoreMapForTest(pairs: PairResult[]): void {
    this.pairScoreMap.clear();
    for (const p of pairs) {
      this.pairScoreMap.set(this.pairKey(p.user1, p.user2), p.score);
    }
  }

  private async createMatchAtomic(user1: string, user2: string, score: number): Promise<void> {
    try {
      const result = await this.matching.createMatch(user1, user2, score);
      if (!result.success || (!result.created && result.reason === "already_matched_elsewhere")) {
        this.logger.debug(`Skip batch match ${user1}-${user2}: ${result.reason || "failed"}`);
        return;
      }
      if (result.created) {
        await this.matching.ensureMatchedStatuses(user1, user2);
        await this.matching.notifyDiscoveryMatched(user1, user2);
        await this.resetFairnessCounter(user1);
        await this.resetFairnessCounter(user2);
      }
    } catch (err) {
      this.logger.warn(`Failed to create match ${user1}-${user2}: ${err}`);
    }
  }
}
