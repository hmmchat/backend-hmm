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

/** In-call hosts who stay put — they cannot take a LOCATION hop. */
export const IMMOBILE_DISCOVERY_STATUSES = new Set([
  "IN_SQUAD_AVAILABLE",
  "IN_BROADCAST_AVAILABLE"
]);

export function countImmobileDiscoveryUsers(
  users: Array<{ status?: string | null }>
): number {
  return users.filter((u) => IMMOBILE_DISCOVERY_STATUSES.has(String(u.status || ""))).length;
}

/**
 * One-sided auto LOCATION handoff (visitor hops, host stays).
 *
 * When two *mobile* solo searchers are each alone in different cities, both
 * must not see LOCATION toward each other (they'd swap and miss). Meet in the
 * lexicographically earlier city: the later-city user is the visitor and gets
 * LOCATION; the earlier-city user stays home until the visitor arrives.
 *
 * Pull-stranger / beamcast hosts are already in a call and cannot hop. A
 * singleton dest that includes them is a stable meeting point — always offer
 * the visitor LOCATION (Delhi empty + Mumbai pull-stranger host).
 *
 * - Destination with immobile hosts: always allow.
 * - Destination with >1 showable users: always allow (stable pool).
 * - Singleton mobile destination: allow only if homeCity > destCity.
 * - Anywhere / null home: always allow.
 *
 * Example: Bangalore alone + Delhi alone → only Delhi sees LOCATION Bangalore.
 */
export function shouldOfferAutoCityHandoff(
  homeCity: string | null | undefined,
  dest: { city: string; availableCount: number; immobileCount?: number }
): boolean {
  const home = normalizeDiscoveryPoolCity(homeCity);
  if (!home) return true;
  if (!Number.isFinite(dest.availableCount) || dest.availableCount <= 0) return false;
  if ((dest.immobileCount ?? 0) > 0) return true;
  if (dest.availableCount > 1) return true;
  const destNorm = normalizeDiscoveryPoolCity(dest.city);
  if (!destNorm || destNorm === home) return false;
  return home.localeCompare(destNorm) > 0;
}

/**
 * Rank cities for empty-pool LOCATION handoff / available-city boxes.
 * Immobile pull-stranger / beamcast hosts are the reason to hop — they
 * outrank raw population so an empty home city lands on that host (C sees A).
 */
export function rankShowableCities<T extends { availableCount: number; immobileCount?: number; label?: string; city?: string }>(
  cities: T[]
): T[] {
  return [...cities].sort((a, b) => {
    const aImm = (a.immobileCount ?? 0) > 0 ? 1 : 0;
    const bImm = (b.immobileCount ?? 0) > 0 ? 1 : 0;
    if (bImm !== aImm) return bImm - aImm;
    if (b.availableCount !== a.availableCount) return b.availableCount - a.availableCount;
    const aLabel = a.label || a.city || "";
    const bLabel = b.label || b.city || "";
    return aLabel.localeCompare(bLabel);
  });
}
