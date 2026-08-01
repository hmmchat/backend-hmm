import {
  computeReportLayer,
  getDiscoveryReportLayerConfig,
  type DiscoveryReportLayerConfig
} from "./report-layers.config.js";

function floatEnv(name: string, defaultVal: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return defaultVal;
  const n = parseFloat(v);
  if (Number.isNaN(n) || n < 0) return defaultVal;
  return Math.min(1, n);
}

/** Moderator mix ratios for report score layers (T1/T2/T3). */
export function getDiscoveryReportMixRatios(): { layer1: number; layer2: number; layer3: number } {
  return {
    layer1: floatEnv("DISCOVERY_REPORT_MIX_L1", 0.3),
    layer2: floatEnv("DISCOVERY_REPORT_MIX_L2", 0.6),
    layer3: floatEnv("DISCOVERY_REPORT_MIX_L3", 0.95)
  };
}

export type ReportPoolMode =
  | { mode: "normal" }
  | { mode: "critical_disguise" }
  | { mode: "post_ban_show_as_mod" }
  | { mode: "score_mix"; modRatio: number; reportLayer: 0 | 1 | 2 | 3 };

export function resolveReportPoolMode(user?: {
  criticalReviewActive?: boolean | null;
  reportModeratorCardsOnly?: boolean | null;
  reportCount?: number | null;
} | null): ReportPoolMode {
  if (!user) return { mode: "normal" };
  if (user.criticalReviewActive) {
    return { mode: "critical_disguise" };
  }
  if (user.reportModeratorCardsOnly) {
    return { mode: "post_ban_show_as_mod" };
  }
  const cfg = getDiscoveryReportLayerConfig();
  const layer = computeReportLayer(user.reportCount ?? 0, cfg);
  if (layer <= 0) {
    return { mode: "normal" };
  }
  const ratios = getDiscoveryReportMixRatios();
  const modRatio = layer === 1 ? ratios.layer1 : layer === 2 ? ratios.layer2 : ratios.layer3;
  return { mode: "score_mix", modRatio, reportLayer: layer };
}

export function isShowAsModerator(user: {
  isModerator?: boolean | null;
  moderatorFaceCardActive?: boolean | null;
}): boolean {
  return Boolean(user.isModerator && user.moderatorFaceCardActive);
}

export function isShowAsUserModerator(user: {
  isModerator?: boolean | null;
  moderatorFaceCardActive?: boolean | null;
}): boolean {
  return Boolean(user.isModerator && !user.moderatorFaceCardActive);
}

export function reportLayerThresholdsPayload(
  cfg?: DiscoveryReportLayerConfig
): DiscoveryReportLayerConfig {
  return cfg ?? getDiscoveryReportLayerConfig();
}
