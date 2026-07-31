/**
 * Deterministic fallback scorer used when:
 * - Semantic features are paused (admin toggle)
 * - A user has no valid UserFeature row
 * - Embedding generation failed and we're past retries
 *
 * Uses only exact/lexical overlap of the structured profile fields.
 * Weights come from MATCHING_SCORE_WEIGHTS (env-configurable).
 */
import { Injectable } from "@nestjs/common";
import { MATCHING_SCORE_WEIGHTS } from "../config/matching-admin.config.js";

export interface FallbackProfile {
  userId: string;
  intent?: string | null;
  musicPreferenceId?: string | null;
  brandIds: string[];
  interestIds: string[];
  valueIds: string[];
  city?: string | null;
}

@Injectable()
export class FallbackScorerService {
  private readonly WEIGHTS = MATCHING_SCORE_WEIGHTS;

  /** Compute 0–100 compatibility score using only exact/lexical overlap */
  score(a: FallbackProfile, b: FallbackProfile): number {
    let score = 0;
    const w = this.WEIGHTS;

    score += this.intentOverlap(a.intent, b.intent) * w.intent;

    if (a.musicPreferenceId && a.musicPreferenceId === b.musicPreferenceId) {
      score += w.song;
    }

    score += this.exactOverlapRatio(a.brandIds, b.brandIds) * w.brands;
    score += this.exactOverlapRatio(a.interestIds, b.interestIds) * w.interests;
    score += this.exactOverlapRatio(a.valueIds, b.valueIds) * w.values;

    if (a.city && a.city === b.city) {
      score += w.location;
    }

    return Math.min(Math.round(score), 100);
  }

  /** Score all pairs in a batch */
  scoreAllPairs(users: FallbackProfile[]): Array<[string, string, number]> {
    const pairs: Array<[string, string, number]> = [];
    for (let i = 0; i < users.length; i++) {
      for (let j = i + 1; j < users.length; j++) {
        pairs.push([users[i].userId, users[j].userId, this.score(users[i], users[j])]);
      }
    }
    return pairs;
  }

  private exactOverlapRatio(arrA: string[], arrB: string[]): number {
    if (arrA.length === 0 || arrB.length === 0) return 0;
    const setA = new Set(arrA);
    const overlap = arrB.filter((id) => setA.has(id)).length;
    return overlap / Math.max(arrA.length, arrB.length);
  }

  /** Lexical intent token overlap (Jaccard) */
  intentOverlap(intentA?: string | null, intentB?: string | null): number {
    if (!intentA || !intentB) return 0;
    const tokensA = new Set(
      intentA.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length >= 3)
    );
    const tokensB = new Set(
      intentB.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length >= 3)
    );
    if (tokensA.size === 0 && tokensB.size === 0) return 1;
    if (tokensA.size === 0 || tokensB.size === 0) return 0;
    let inter = 0;
    for (const t of tokensA) if (tokensB.has(t)) inter++;
    return inter / (tokensA.size + tokensB.size - inter);
  }
}
