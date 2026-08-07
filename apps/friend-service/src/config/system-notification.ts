export type SystemNotificationLine = "BEAM" | "BEAM_MOD";

export function getBeamSystemUserId(): string {
  return process.env.BEAM_SYSTEM_USER_ID || "system_beam";
}

export function getBeamModSystemUserId(): string {
  return process.env.BEAM_MOD_SYSTEM_USER_ID || "system_beam_mod";
}

export function getSystemUserIdForLine(line: SystemNotificationLine): string {
  return line === "BEAM" ? getBeamSystemUserId() : getBeamModSystemUserId();
}

export function getLineForSystemUserId(userId: string): SystemNotificationLine | null {
  if (userId === getBeamSystemUserId()) return "BEAM";
  if (userId === getBeamModSystemUserId()) return "BEAM_MOD";
  return null;
}

export function isSystemNotificationUserId(userId: string): boolean {
  return getLineForSystemUserId(userId) !== null;
}

export function systemDisplayName(line: SystemNotificationLine): string {
  return line === "BEAM" ? "BEAM" : "BEAM MOD";
}
