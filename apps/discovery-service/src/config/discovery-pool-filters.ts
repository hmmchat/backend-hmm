import {
  isShowAsUserModerator,
  resolveReportPoolMode,
  type ReportPoolMode
} from "./report-pool.config.js";

type Gender = "MALE" | "FEMALE" | "NON_BINARY" | "PREFER_NOT_TO_SAY";

/**
 * Statuses that enter the live matchmaking / face-card pool.
 * City handoff + available-cities MUST use this same set — anything showable
 * as a face card must also make its city handoff-eligible.
 */
export const DISCOVERY_MATCHMAKING_STATUSES = [
  "AVAILABLE",
  "IN_SQUAD_AVAILABLE",
  "IN_BROADCAST_AVAILABLE"
] as const;

export type DiscoveryMatchmakingStatus = (typeof DISCOVERY_MATCHMAKING_STATUSES)[number];

type Status = DiscoveryMatchmakingStatus;

export type DiscoveryPoolRequester = {
  isModerator?: boolean | null;
  moderatorFaceCardActive?: boolean | null;
  kycStatus?: string | null;
  reportCount?: number | null;
  reportModeratorCardsOnly?: boolean | null;
  criticalReviewActive?: boolean | null;
};

/**
 * Build user-service /users/discovery filters for report-aware pools.
 * Callers still apply raincheck / matched / session filters client-side.
 */
export function buildReportAwareDiscoveryFilters(args: {
  city: string | null;
  statuses: Status[];
  genders?: Gender[];
  excludeUserIds?: string[];
  limit: number;
  requester?: DiscoveryPoolRequester | null;
  prioritizeKyc?: boolean;
}): { filters: Record<string, unknown>; poolMode: ReportPoolMode } {
  const requester = args.requester || {};
  const poolMode = resolveReportPoolMode(requester);
  const requesterIsDisguisedMod = isShowAsUserModerator(requester);
  const requesterIsModerator = Boolean(requester.isModerator);
  const requesterKycStatus = requester.kycStatus || "UNVERIFIED";
  const priorityEnabled = Boolean(args.prioritizeKyc);

  const base = {
    city: args.city,
    statuses: args.statuses,
    genders: args.genders,
    excludeUserIds: args.excludeUserIds,
    limit: args.limit
  };

  if (requesterIsDisguisedMod) {
    return {
      poolMode,
      filters: { ...base, onlyCriticalReview: true }
    };
  }
  // Show-as-moderator: FCFS work queue — needs-KYC ∪ T1–T3 only (no general verified users).
  if (requesterIsModerator) {
    return {
      poolMode: { mode: "normal" },
      filters: {
        ...base,
        moderatorVisibility: "exclude_disguised",
        excludeModerators: true,
        moderatorWorkQueue: true
      }
    };
  }
  if (poolMode.mode === "critical_disguise") {
    return {
      poolMode,
      filters: {
        ...base,
        onlyModerators: true,
        moderatorVisibility: "show_as_user"
      }
    };
  }
  if (poolMode.mode === "post_ban_show_as_mod") {
    return {
      poolMode,
      filters: {
        ...base,
        onlyModerators: true,
        moderatorVisibility: "show_as_mod"
      }
    };
  }
  if (poolMode.mode === "score_mix") {
    return {
      poolMode,
      filters: {
        ...base,
        moderatorVisibility: "exclude_disguised",
        excludeModerators: false
      }
    };
  }

  return {
    poolMode,
    filters: {
      ...base,
      moderatorVisibility: "exclude_disguised",
      excludeModerators: priorityEnabled && requesterKycStatus === "VERIFIED",
    }
  };
}

/** After fetching candidates, apply score-mix / empty-bucket policy. */
export function applyReportPoolBucket<T extends {
  isModerator?: boolean | null;
  moderatorFaceCardActive?: boolean | null;
}>(users: T[], poolMode: ReportPoolMode): T[] {
  if (poolMode.mode !== "score_mix") {
    return users;
  }
  const wantMod = Math.random() < poolMode.modRatio;
  const mods = users.filter((u) => Boolean(u.isModerator && u.moderatorFaceCardActive));
  const normals = users.filter((u) => !u.isModerator);
  const preferred = wantMod ? mods : normals;
  // Prefer the rolled bucket, but never hide the only live peer (e.g. Bangalore↔Delhi
  // city handoff) when that bucket is empty.
  if (preferred.length > 0) return preferred;
  const fallback = wantMod ? normals : mods;
  return fallback.length > 0 ? fallback : users;
}
