/**
 * Admin-configurable toggles for the matchmaking pipeline.
 * All read via env vars with sensible defaults.
 *
 * MATCHING_MODE:
 * - live_legacy: card path uses MatchingService immediately; allocator does not persist
 * - shadow: allocator scores + logs only; card path stays live_legacy
 * - batch_primary: allocator persists matches; card path waits briefly then falls back
 */

function boolEnv(name: string, defaultVal: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return defaultVal;
  return v === "true" || v === "1";
}

export type MatchingMode = "live_legacy" | "shadow" | "batch_primary";

function matchingModeEnv(): MatchingMode {
  const v = (process.env.MATCHING_MODE || "live_legacy").toLowerCase().trim();
  if (v === "shadow" || v === "batch_primary" || v === "live_legacy") return v;
  return "live_legacy";
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
 * When MATCHING_MODE=batch_primary and this list is non-empty, only these preferred
 * cities use batch allocation; everyone else stays on live_legacy.
 * Comma-separated, case-insensitive. Empty = all cities.
 */
export const MATCHING_CANARY_CITIES: string[] = (process.env.MATCHING_CANARY_CITIES || "")
  .split(",")
  .map((c) => c.trim().toLowerCase())
  .filter(Boolean);

export const MATCHMAKING_MONTHLY_BUDGET_INR = parseFloat(process.env.MATCHMAKING_MONTHLY_BUDGET_INR || "10000");
export const MATCHMAKING_DAILY_BUDGET_INR = parseFloat(process.env.MATCHMAKING_DAILY_BUDGET_INR || "500");
export const FEATURE_GENERATION_JOB_LEASE_MS = parseInt(process.env.FEATURE_GENERATION_JOB_LEASE_MS || "120000", 10);
export const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN || "";

/** True when this preferred city should use batch_primary persistence/wait behavior. */
export function isBatchPrimaryForCity(preferredCity: string | null | undefined): boolean {
  if (MATCHING_MODE !== "batch_primary") return false;
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
