/**
 * Minimum profile required to enter matchmaking (Meet Someone).
 * Watching Beam TV does not use this gate.
 */

const PLACEHOLDER_PHOTO_RE = /via\.placeholder\.com/i;

export function isPlaceholderDisplayPicture(url: string | null | undefined): boolean {
  if (typeof url !== "string") return true;
  const trimmed = url.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith("blob:") || trimmed.startsWith("data:")) return true;
  return PLACEHOLDER_PHOTO_RE.test(trimmed);
}

export type MatchmakingProfileFields = {
  username?: string | null;
  dateOfBirth?: string | Date | null;
  gender?: string | null;
  displayPictureUrl?: string | null;
  intent?: string | null;
};

export function getMatchmakingProfileGap(
  user: MatchmakingProfileFields | null | undefined
): string | null {
  if (!user) return "Incomplete profile";
  if (!String(user.username || "").trim()) return "Name is required";
  if (!user.dateOfBirth) return "Date of birth is required";
  if (!user.gender) return "Gender is required";
  if (isPlaceholderDisplayPicture(user.displayPictureUrl)) return "A profile photo is required";
  if (!String(user.intent || "").trim()) return "Intent is required";
  return null;
}

export function isMatchmakingProfileComplete(
  user: MatchmakingProfileFields | null | undefined
): boolean {
  return getMatchmakingProfileGap(user) == null;
}
