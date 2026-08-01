import {
  isShowAsUserModerator,
  resolveReportPoolMode,
  type ReportPoolMode
} from "./report-pool.config.js";

type Gender = "MALE" | "FEMALE" | "NON_BINARY" | "PREFER_NOT_TO_SAY";
type Status = "AVAILABLE" | "IN_SQUAD_AVAILABLE" | "IN_BROADCAST_AVAILABLE";

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
        excludeModerators: false,
        excludeKycStatuses: requesterIsModerator ? ["VERIFIED"] : []
      }
    };
  }

  return {
    poolMode,
    filters: {
      ...base,
      moderatorVisibility: "exclude_disguised",
      excludeModerators:
        requesterIsModerator || (priorityEnabled && requesterKycStatus === "VERIFIED"),
      excludeKycStatuses: requesterIsModerator ? ["VERIFIED"] : []
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
  const bucket = wantMod ? mods : normals;
  return bucket;
}
