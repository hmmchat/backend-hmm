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

/**
 * One-sided auto LOCATION handoff (visitor hops, host stays).
 *
 * When two users are each alone in different cities, both must not see LOCATION
 * toward each other (they'd swap and miss). Meet in the lexicographically
 * earlier city: the later-city user is the visitor and gets LOCATION; the
 * earlier-city user stays home until the visitor arrives.
 *
 * - Destination with >1 showable users: always allow (stable pool).
 * - Singleton destination: allow only if homeCity > destCity (case-insensitive).
 * - Anywhere / null home: always allow.
 *
 * Example: Bangalore alone + Delhi alone → only Delhi sees LOCATION Bangalore.
 */
export function shouldOfferAutoCityHandoff(
  homeCity: string | null | undefined,
  dest: { city: string; availableCount: number }
): boolean {
  const home = normalizeDiscoveryPoolCity(homeCity);
  if (!home) return true;
  if (!Number.isFinite(dest.availableCount) || dest.availableCount <= 0) return false;
  if (dest.availableCount > 1) return true;
  const destNorm = normalizeDiscoveryPoolCity(dest.city);
  if (!destNorm || destNorm === home) return false;
  return home.localeCompare(destNorm) > 0;
}
