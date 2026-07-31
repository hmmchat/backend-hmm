/**
 * Admin-configurable toggles for the matchmaking pipeline.
 * All read via env vars with sensible defaults.
 *
 * MATCHING_MODE (default batch_primary — app is not live yet; full rollout):
 * - batch_primary: allocator persists matches; card path waits briefly then falls back to legacy
 * - shadow: allocator scores + logs only; card path stays live_legacy
 * - live_legacy: card path uses MatchingService immediately; allocator does not persist
 */

function boolEnv(name: string, defaultVal: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return defaultVal;
  return v === "true" || v === "1";
}

export type MatchingMode = "live_legacy" | "shadow" | "batch_primary";

function matchingModeEnv(): MatchingMode {
  const v = (process.env.MATCHING_MODE || "batch_primary").toLowerCase().trim();
  if (v === "shadow" || v === "batch_primary" || v === "live_legacy") return v;
  return "batch_primary";
}

export const MATCHING_PAUSED = boolEnv("MATCHING_PAUSED", false);
export const MATCHING_SEMANTIC_ENABLED = boolEnv("MATCHING_SEMANTIC_ENABLED", true);
export const MATCHING_MODE: MatchingMode = matchingModeEnv();
export const MATCHING_ALLOCATOR_INTERVAL_MS = parseInt(process.env.MATCHING_ALLOCATOR_INTERVAL_MS || "2000", 10);
export const MATCHING_MAX_POOL_SIZE = parseInt(process.env.MATCHING_MAX_POOL_SIZE || "1000", 10);
export const MATCHING_2OPT_ITERATIONS = parseInt(process.env.MATCHING_2OPT_ITERATIONS || "2", 10);
export const MATCHING_FAIRNESS_WAIT_BOOST = parseFloat(process.env.MATCHING_FAIRNESS_WAIT_BOOST || "0.1");
/** How long getNextCard waits for a batch match before legacy fallback (batch_primary only). */
export const MATCHING_CARD_WAIT_MS = parseInt(process.env.MATCHING_CARD_WAIT_MS || "2500", 10);
/**
 * Optional city restrict list. Leave empty for full rollout (all cities).
 * When non-empty with MATCHING_MODE=batch_primary, only these preferred cities
 * use batch allocation; everyone else stays on live_legacy wait/fallback skip.
 * Comma-separated, case-insensitive.
 */
export const MATCHING_CANARY_CITIES: string[] = (process.env.MATCHING_CANARY_CITIES || "")
  .split(",")
  .map((c) => c.trim().toLowerCase())
  .filter(Boolean);

export const MATCHMAKING_MONTHLY_BUDGET_INR = parseFloat(process.env.MATCHMAKING_MONTHLY_BUDGET_INR || "10000");
export const MATCHMAKING_DAILY_BUDGET_INR = parseFloat(process.env.MATCHMAKING_DAILY_BUDGET_INR || "500");
export const FEATURE_GENERATION_JOB_LEASE_MS = parseInt(process.env.FEATURE_GENERATION_JOB_LEASE_MS || "120000", 10);
export const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN || "";

/**
 * Score dimension weights (should sum to ~100). Defaults: intent 50%, remaining 50%
 * keeps the previous song:brands:interests:values:location ratio (25:18:15:8:4).
 *
 * Env overrides (floats OK):
 * MATCHING_SCORE_WEIGHT_INTENT, _SONG, _BRANDS, _INTERESTS, _VALUES, _LOCATION
 */
export interface MatchingScoreWeights {
  intent: number;
  song: number;
  brands: number;
  interests: number;
  values: number;
  location: number;
}

function floatEnv(name: string, defaultVal: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return defaultVal;
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : defaultVal;
}

/** Previous non-intent ratio 25:18:15:8:4 scaled into 50 points. */
const DEFAULT_NON_INTENT_TOTAL = 50;
const LEGACY_NON_INTENT = { song: 25, brands: 18, interests: 15, values: 8, location: 4 } as const;
const LEGACY_NON_INTENT_SUM =
  LEGACY_NON_INTENT.song +
  LEGACY_NON_INTENT.brands +
  LEGACY_NON_INTENT.interests +
  LEGACY_NON_INTENT.values +
  LEGACY_NON_INTENT.location;

function scaleLegacy(part: number): number {
  return (part / LEGACY_NON_INTENT_SUM) * DEFAULT_NON_INTENT_TOTAL;
}

function buildScoreWeights(): MatchingScoreWeights {
  const raw: MatchingScoreWeights = {
    intent: floatEnv("MATCHING_SCORE_WEIGHT_INTENT", 50),
    song: floatEnv("MATCHING_SCORE_WEIGHT_SONG", scaleLegacy(LEGACY_NON_INTENT.song)),
    brands: floatEnv("MATCHING_SCORE_WEIGHT_BRANDS", scaleLegacy(LEGACY_NON_INTENT.brands)),
    interests: floatEnv("MATCHING_SCORE_WEIGHT_INTERESTS", scaleLegacy(LEGACY_NON_INTENT.interests)),
    values: floatEnv("MATCHING_SCORE_WEIGHT_VALUES", scaleLegacy(LEGACY_NON_INTENT.values)),
    location: floatEnv("MATCHING_SCORE_WEIGHT_LOCATION", scaleLegacy(LEGACY_NON_INTENT.location))
  };

  const sum =
    raw.intent + raw.song + raw.brands + raw.interests + raw.values + raw.location;
  if (sum <= 0) {
    return {
      intent: 50,
      song: scaleLegacy(25),
      brands: scaleLegacy(18),
      interests: scaleLegacy(15),
      values: scaleLegacy(8),
      location: scaleLegacy(4)
    };
  }

  // Normalize to 100 so misconfigured envs still produce a 0–100 score.
  if (Math.abs(sum - 100) > 0.01) {
    const k = 100 / sum;
    return {
      intent: raw.intent * k,
      song: raw.song * k,
      brands: raw.brands * k,
      interests: raw.interests * k,
      values: raw.values * k,
      location: raw.location * k
    };
  }
  return raw;
}

export const MATCHING_SCORE_WEIGHTS: MatchingScoreWeights = buildScoreWeights();

/** True when this preferred city should use batch_primary persistence/wait behavior. */
export function isBatchPrimaryForCity(preferredCity: string | null | undefined): boolean {
  if (MATCHING_MODE !== "batch_primary") return false;
  // Full rollout: empty restrict list → all users (including anywhere / null city).
  if (MATCHING_CANARY_CITIES.length === 0) return true;
  const city = (preferredCity || "").trim().toLowerCase();
  if (!city) return false;
  return MATCHING_CANARY_CITIES.includes(city);
}

export function shouldAllocatorPersist(): boolean {
  return MATCHING_MODE === "batch_primary";
}

export function shouldAllocatorShadowLog(): boolean {
  return MATCHING_MODE === "shadow" || MATCHING_MODE === "batch_primary";
}
