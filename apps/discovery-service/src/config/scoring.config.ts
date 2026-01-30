/**
 * Discovery match scoring configuration.
 * All values are read from environment variables with defaults matching original behavior.
 */

function intEnv(name: string, defaultVal: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return defaultVal;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? defaultVal : n;
}

/** Points per common brand */
export const MATCH_SCORE_BRAND = intEnv("MATCH_SCORE_BRAND", 10);

/** Points per exact interest match (same sub-genre) */
export const MATCH_SCORE_INTEREST_EXACT = intEnv("MATCH_SCORE_INTEREST_EXACT", 15);

/** Points per genre match (same genre, different sub-genre) */
export const MATCH_SCORE_INTEREST_GENRE = intEnv("MATCH_SCORE_INTEREST_GENRE", 10);

/** Points per common value */
export const MATCH_SCORE_VALUE = intEnv("MATCH_SCORE_VALUE", 20);

/** Points when music preference matches */
export const MATCH_SCORE_MUSIC = intEnv("MATCH_SCORE_MUSIC", 30);

/** Points when same city (anywhere mode) */
export const MATCH_SCORE_SAME_CITY = intEnv("MATCH_SCORE_SAME_CITY", 50);

/** Points when video preference matches */
export const MATCH_SCORE_VIDEO = intEnv("MATCH_SCORE_VIDEO", 100);

// --- Broadcast recommendation scoring ---

/** Points for trending broadcast */
export const MATCH_SCORE_BROADCAST_TRENDING = intEnv("MATCH_SCORE_BROADCAST_TRENDING", 50);

/** Max points from popularity score (popularityScore / 10 capped) */
export const MATCH_SCORE_BROADCAST_POPULARITY_CAP = intEnv("MATCH_SCORE_BROADCAST_POPULARITY_CAP", 30);

/** Max points from viewer count (viewerCount / 5 capped) */
export const MATCH_SCORE_BROADCAST_VIEWERS_CAP = intEnv("MATCH_SCORE_BROADCAST_VIEWERS_CAP", 20);

/** Points when broadcast started < 1 hour ago */
export const MATCH_SCORE_BROADCAST_RECENCY_VERY = intEnv("MATCH_SCORE_BROADCAST_RECENCY_VERY", 15);

/** Points when broadcast started < 6 hours ago */
export const MATCH_SCORE_BROADCAST_RECENCY_RECENT = intEnv("MATCH_SCORE_BROADCAST_RECENCY_RECENT", 10);

/** Points when broadcast started < 24 hours ago */
export const MATCH_SCORE_BROADCAST_RECENCY_TODAY = intEnv("MATCH_SCORE_BROADCAST_RECENCY_TODAY", 5);

/** Points per matching tag/interest with user profile */
export const MATCH_SCORE_BROADCAST_TAG = intEnv("MATCH_SCORE_BROADCAST_TAG", 5);
