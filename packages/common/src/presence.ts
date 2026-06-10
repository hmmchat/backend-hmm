/** Statuses owned by discovery/streaming flows — do not override with presence. */
export const PRESENCE_PROTECTED_STATUSES = new Set([
  "AVAILABLE",
  "MATCHED",
  "IN_SQUAD",
  "IN_SQUAD_AVAILABLE",
  "IN_BROADCAST",
  "IN_BROADCAST_AVAILABLE"
]);

export function canTransitionToOnline(currentStatus: string): boolean {
  return !PRESENCE_PROTECTED_STATUSES.has(currentStatus);
}

export function canTransitionToOffline(currentStatus: string): boolean {
  if (PRESENCE_PROTECTED_STATUSES.has(currentStatus)) {
    return false;
  }
  return currentStatus === "ONLINE" || currentStatus === "VIEWER";
}

export function isPresenceStale(
  lastActiveAt: Date | null | undefined,
  staleAfterMs: number = 120_000
): boolean {
  if (!lastActiveAt) {
    return true;
  }
  return Date.now() - lastActiveAt.getTime() > staleAfterMs;
}

/**
 * Resolve stored status for presence UI (messaging green dot, OFFLINE cards).
 * Idle users without a recent heartbeat are treated as OFFLINE.
 */
export function resolveEffectivePresenceStatus(
  status: string,
  lastActiveAt: Date | null | undefined,
  staleAfterMs: number = 120_000
): string {
  if (PRESENCE_PROTECTED_STATUSES.has(status)) {
    return status;
  }
  if (status === "OFFLINE") {
    return "OFFLINE";
  }
  if (isPresenceStale(lastActiveAt, staleAfterMs)) {
    return "OFFLINE";
  }
  return status;
}

export function mapUserStatusToMessagingPresence(
  effectiveStatus: string,
  isBroadcasting: boolean
): "online" | "offline" | "broadcasting" {
  if (isBroadcasting) {
    return "broadcasting";
  }
  if (effectiveStatus === "OFFLINE") {
    return "offline";
  }
  return "online";
}
