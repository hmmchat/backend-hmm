/**
 * Report UI / pool tiers — keep aligned with discovery-service `report-layers.config.ts`
 * and the same env knobs (`DISCOVERY_REPORT_LAYER_*`, `REPORT_THRESHOLD`).
 */

function intEnv(name: string, defaultVal: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return defaultVal;
  const n = parseInt(v, 10);
  return Number.isNaN(n) || n < 0 ? defaultVal : n;
}

export function getReportBanThreshold(): number {
  const raw = parseInt(process.env.REPORT_THRESHOLD || "5", 10);
  if (Number.isNaN(raw) || raw < 1) {
    return 5;
  }
  return raw;
}

export type ReportLayerConfig = {
  layer1: number;
  layer2: number;
  layer3: number;
  ban: number;
};

export function getReportLayerConfig(): ReportLayerConfig {
  const ban = getReportBanThreshold();
  let l1 = intEnv("DISCOVERY_REPORT_LAYER_1", 20);
  let l2 = intEnv("DISCOVERY_REPORT_LAYER_2", 30);
  let l3 = intEnv("DISCOVERY_REPORT_LAYER_3", 40);

  if (ban <= 4) {
    const l1n = Math.max(1, ban - 3);
    const l2n = Math.max(l1n + 1, ban - 2);
    const l3n = Math.max(l2n + 1, ban - 1);
    return { layer1: l1n, layer2: l2n, layer3: l3n, ban };
  }

  l3 = Math.min(l3, ban - 1);
  l2 = Math.min(l2, l3 - 1);
  l1 = Math.min(l1, l2 - 1);
  if (l1 < 1) l1 = 1;
  if (l2 <= l1) l2 = l1 + 1;
  if (l3 <= l2) l3 = l2 + 1;
  if (l3 >= ban) l3 = ban - 1;

  return { layer1: l1, layer2: l2, layer3: l3, ban };
}

export function computeReportLayer(reportCount: number, cfg: ReportLayerConfig): 0 | 1 | 2 | 3 {
  const c = Math.max(0, reportCount || 0);
  if (c < cfg.layer1) return 0;
  if (c < cfg.layer2) return 1;
  if (c < cfg.layer3) return 2;
  if (c < cfg.ban) return 3;
  return 3;
}

/** KYC statuses that still need moderator attention. */
export const NEEDS_KYC_STATUSES = ["UNVERIFIED", "PENDING_REVIEW", "REVOKED", "EXPIRED"] as const;
