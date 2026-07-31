/**
 * Semantic scorer using precomputed intent embedding vectors.
 *
 * Reads UserFeature vectors from the DB and computes cosine similarity
 * for the intent field (weight 30) only when provider=hosted.
 * Structured fields (song, brands, interests, values, location) use exact/lexical overlap.
 */
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { MATCHING_SEMANTIC_ENABLED } from "../config/matching-admin.config.js";
import { FallbackScorerService } from "./fallback-scorer.service.js";

export interface SemanticProfile {
  userId: string;
  intent?: string | null;
  musicPreferenceId?: string | null;
  brandIds: string[];
  interestIds: string[];
  valueIds: string[];
  city?: string | null;
}

interface UserFeatureRow {
  userId: string;
  vector: number[];
  checksum: string;
  version: number;
  provider: string;
}

@Injectable()
export class SemanticScorerService {
  private featureCache = new Map<string, UserFeatureRow>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly fallbackScorer: FallbackScorerService
  ) {}

  private readonly WEIGHTS = {
    intent: 30,
    song: 25,
    brands: 18,
    interests: 15,
    values: 8,
    location: 4
  } as const;

  /**
   * Compute compatibility score 0–100 between two profiles.
   * Uses semantic vectors when both have hosted features; otherwise lexical intent.
   */
  async score(a: SemanticProfile, b: SemanticProfile): Promise<number> {
    await this.ensureFeaturesLoaded([a.userId, b.userId]);

    const featA = this.featureCache.get(a.userId);
    const featB = this.featureCache.get(b.userId);
    const useSemantic =
      MATCHING_SEMANTIC_ENABLED &&
      featA?.provider === "hosted" &&
      featB?.provider === "hosted" &&
      Array.isArray(featA.vector) &&
      Array.isArray(featB.vector) &&
      featA.vector.length > 0 &&
      featA.vector.length === featB.vector.length;

    let score = 0;

    if (useSemantic && a.intent && b.intent) {
      score += this.cosineSimilarity(featA!.vector, featB!.vector) * this.WEIGHTS.intent;
    } else {
      score += this.fallbackIntentScore(a.intent, b.intent) * this.WEIGHTS.intent;
    }

    if (a.musicPreferenceId && a.musicPreferenceId === b.musicPreferenceId) {
      score += this.WEIGHTS.song;
    }

    if (a.brandIds.length && b.brandIds.length) {
      score += this.exactOverlapRatio(a.brandIds, b.brandIds) * this.WEIGHTS.brands;
    }

    if (a.interestIds.length && b.interestIds.length) {
      score += this.exactOverlapRatio(a.interestIds, b.interestIds) * this.WEIGHTS.interests;
    }

    if (a.valueIds.length && b.valueIds.length) {
      score += this.exactOverlapRatio(a.valueIds, b.valueIds) * this.WEIGHTS.values;
    }

    if (a.city && a.city === b.city) {
      score += this.WEIGHTS.location;
    }

    return Math.min(Math.round(score), 100);
  }

  /** Score all pairs — always preloads the full user list first. */
  async scoreAllPairs(users: SemanticProfile[]): Promise<Array<[string, string, number]>> {
    await this.preloadFeatures(users.map((u) => u.userId));

    const pairs: Array<[string, string, number]> = [];
    for (let i = 0; i < users.length; i++) {
      for (let j = i + 1; j < users.length; j++) {
        const score = await this.score(users[i], users[j]);
        pairs.push([users[i].userId, users[j].userId, score]);
      }
    }
    return pairs;
  }

  /**
   * Load UserFeature rows for the given user IDs into the in-memory cache.
   * Always merges requested IDs; never short-circuits on a partial prior cache.
   */
  async preloadFeatures(userIds: string[]): Promise<void> {
    const unique = [...new Set(userIds.filter(Boolean))];
    if (unique.length === 0) return;

    const missing = unique.filter((id) => !this.featureCache.has(id));
    if (missing.length === 0) return;

    const rows = await (this.prisma as any).userFeature.findMany({
      where: { userId: { in: missing } },
      select: { userId: true, vector: true, checksum: true, version: true, provider: true }
    });

    for (const r of rows) {
      this.featureCache.set(r.userId, {
        userId: r.userId,
        vector: r.vector as number[],
        checksum: r.checksum,
        version: r.version,
        provider: r.provider || "hosted"
      });
    }

    // Mark missing as absent so we don't re-query every pair
    for (const id of missing) {
      if (!this.featureCache.has(id)) {
        this.featureCache.set(id, {
          userId: id,
          vector: [],
          checksum: "",
          version: 0,
          provider: "missing"
        });
      }
    }
  }

  /** Clear in-memory feature cache (e.g. between allocator cycles). */
  clearCache(): void {
    this.featureCache.clear();
  }

  /** Coverage stats for admin. */
  async getCoverageStats(): Promise<{ withFeatures: number; withoutFeatures: number; hosted: number; fallback: number }> {
    const [hosted, fallback, totalFeatures] = await Promise.all([
      (this.prisma as any).userFeature.count({ where: { provider: "hosted" } }),
      (this.prisma as any).userFeature.count({ where: { provider: "fallback" } }),
      (this.prisma as any).userFeature.count()
    ]);
    return {
      withFeatures: totalFeatures,
      withoutFeatures: 0,
      hosted,
      fallback
    };
  }

  private async ensureFeaturesLoaded(userIds: string[]): Promise<void> {
    await this.preloadFeatures(userIds);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return Math.max(0, Math.min(1, dot));
  }

  private exactOverlapRatio(arrA: string[], arrB: string[]): number {
    if (arrA.length === 0 || arrB.length === 0) return 0;
    const setA = new Set(arrA);
    const overlap = arrB.filter((id) => setA.has(id)).length;
    return overlap / Math.max(arrA.length, arrB.length);
  }

  fallbackIntentScore(intentA?: string | null, intentB?: string | null): number {
    return this.fallbackScorer.intentOverlap(intentA, intentB);
  }
}
