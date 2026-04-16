/**
 * Same env as discovery-service REPORT_THRESHOLD (default 5).
 * When reportCount >= threshold, user-service may apply auto-ban + discovery restrictions.
 */
export function getReportThreshold(): number {
  const raw = parseInt(process.env.REPORT_THRESHOLD || "5", 10);
  if (Number.isNaN(raw) || raw < 1) {
    return 5;
  }
  return raw;
}
