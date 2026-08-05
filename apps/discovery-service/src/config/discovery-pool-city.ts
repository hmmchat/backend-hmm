import { isPreferredCityAnywhere } from "@hmm/common";

/** Session-only marker used by discovery for “all cities this session”. */
export const SESSION_DISCOVERY_POOL_ANYWHERE = "*";

/**
 * Normalize a preferred / session pool city for equality checks.
 * Anywhere / null / session `*` → null (global pool key).
 */
export function normalizeDiscoveryPoolCity(city: string | null | undefined): string | null {
  if (city === null || city === undefined) return null;
  const trimmed = String(city).trim();
  if (!trimmed || trimmed === SESSION_DISCOVERY_POOL_ANYWHERE) return null;
  if (isPreferredCityAnywhere(trimmed)) return null;
  return trimmed.toLowerCase();
}

/** True when both users belong to the same discovery pool (city-scoped or both Anywhere). */
export function sameDiscoveryPoolCity(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  return normalizeDiscoveryPoolCity(a) === normalizeDiscoveryPoolCity(b);
}
