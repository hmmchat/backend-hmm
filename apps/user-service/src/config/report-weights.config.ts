/**
 * Report weight configuration. Weights are read from environment variables.
 * reportCount on User stores the sum of weights (report score); discovery compares it to REPORT_THRESHOLD.
 */

const REPORT_WEIGHT_ENV_PREFIX = "REPORT_WEIGHT_";

/** Map reportType (normalized) to env suffix. Unknown types use default weight. */
const REPORT_TYPE_TO_ENV: Record<string, string> = {
  default: "DEFAULT",
  face_card: "FACE_CARD",
  offline_card: "OFFLINE_CARD",
  host: "HOST",
  participant_host: "PARTICIPANT_HOST",
  participant: "PARTICIPANT"
};

function intEnv(name: string, defaultVal: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return defaultVal;
  const n = parseInt(v, 10);
  return Number.isNaN(n) || n < 0 ? defaultVal : n;
}

function getWeightForType(envSuffix: string): number {
  const key = `${REPORT_WEIGHT_ENV_PREFIX}${envSuffix}`;
  switch (envSuffix) {
    case "DEFAULT":
      return intEnv(key, 1);
    case "FACE_CARD":
      return intEnv(key, 5);
    case "OFFLINE_CARD":
      return intEnv(key, 5);
    case "HOST":
      return intEnv(key, 10);
    case "PARTICIPANT_HOST":
      return intEnv(key, 3);
    case "PARTICIPANT":
      return intEnv(key, 5);
    default:
      return intEnv("REPORT_WEIGHT_DEFAULT", 1);
  }
}

const weightCache: Record<string, number> = {};

/**
 * Resolve report weight for the given reportType. Unknown or missing reportType uses default weight.
 */
export function getReportWeight(reportType?: string | null): number {
  if (reportType === undefined || reportType === null || reportType === "") {
    return getWeightForType("DEFAULT");
  }
  const normalized = reportType.toLowerCase().trim().replace(/-/g, "_");
  if (weightCache[normalized] !== undefined) {
    return weightCache[normalized];
  }
  const envSuffix = REPORT_TYPE_TO_ENV[normalized];
  const weight = envSuffix ? getWeightForType(envSuffix) : getWeightForType("DEFAULT");
  weightCache[normalized] = weight;
  return weight;
}
