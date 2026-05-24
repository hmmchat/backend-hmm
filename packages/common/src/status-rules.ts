export type PresenceStatus = "AVAILABLE" | "ONLINE";

export type RestorablePresenceStatus =
  | PresenceStatus
  | "VIEWER"
  | "IN_SQUAD"
  | "IN_BROADCAST"
  | "IN_SQUAD_AVAILABLE"
  | "IN_BROADCAST_AVAILABLE";

/**
 * After match acceptance timeout: users who accepted stay discoverable;
 * passive users without an active discovery session return to ONLINE.
 */
export function resolveAcceptanceTimeoutStatus(
  userId: string,
  acceptedBy: Set<string>,
  hasActiveDiscoverySession: boolean
): PresenceStatus {
  if (acceptedBy.has(userId) || hasActiveDiscoverySession) {
    return "AVAILABLE";
  }
  return "ONLINE";
}

/**
 * Rainchecked partner: only stay AVAILABLE if they still have active discovery intent.
 */
export function resolveRaincheckPartnerStatus(hasActiveDiscoverySession: boolean): PresenceStatus {
  return hasActiveDiscoverySession ? "AVAILABLE" : "ONLINE";
}

/**
 * Room end participant restore: never revert to MATCHED; preserve explicit AVAILABLE.
 */
export function resolveRoomEndParticipantStatus(
  previousStatus: string | null | undefined,
  currentStatus: string | null | undefined
): RestorablePresenceStatus {
  if (currentStatus === "AVAILABLE") {
    return "AVAILABLE";
  }

  const previous = previousStatus || "ONLINE";
  if (previous === "MATCHED") {
    return "ONLINE";
  }

  if (
    previous === "AVAILABLE" ||
    previous === "ONLINE" ||
    previous === "VIEWER" ||
    previous === "IN_SQUAD" ||
    previous === "IN_BROADCAST" ||
    previous === "IN_SQUAD_AVAILABLE" ||
    previous === "IN_BROADCAST_AVAILABLE"
  ) {
    return previous;
  }

  return "ONLINE";
}
