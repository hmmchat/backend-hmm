/**
 * Env fallbacks when DB row is missing or displayPictureUrl is unset.
 * Prefer dashboard: GET/PATCH /v1/admin/moderator-face-card (user-service).
 */

export interface ModeratorFaceCardPresentation {
  username: string;
  intent: string;
  displayPictureUrl: string;
  city: string;
}

export const MODERATOR_FACE_CARD_SETTING_ID = "default";

export function moderatorFaceCardPresentationFromEnv(): ModeratorFaceCardPresentation {
  return {
    username: process.env.MODERATOR_FACE_CARD_USERNAME?.trim() || "Moderator",
    intent: process.env.MODERATOR_FACE_CARD_INTENT?.trim() || "Moderation",
    displayPictureUrl: process.env.MODERATOR_FACE_CARD_DISPLAY_PICTURE_URL?.trim() || "",
    city: process.env.MODERATOR_FACE_CARD_CITY?.trim() || "Beam"
  };
}

export function mergeModeratorFaceCardPresentation(
  row: Partial<ModeratorFaceCardPresentation> | null | undefined
): ModeratorFaceCardPresentation {
  const env = moderatorFaceCardPresentationFromEnv();
  if (!row) {
    return env;
  }
  return {
    username: row.username?.trim() || env.username,
    intent: row.intent?.trim() || env.intent,
    displayPictureUrl:
      row.displayPictureUrl?.trim() || env.displayPictureUrl,
    city: row.city?.trim() || env.city
  };
}

export function shouldUseModeratorFaceCard(user: {
  isModerator?: boolean;
  moderatorFaceCardActive?: boolean;
}): boolean {
  return Boolean(user.isModerator && user.moderatorFaceCardActive);
}
