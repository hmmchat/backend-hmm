/**
 * Discovery-service: fetch presentation from user-service (cached). Env vars are fallback only.
 */

export interface ModeratorFaceCardPresentation {
  username: string;
  intent: string;
  displayPictureUrl: string;
  city: string;
}

export function moderatorFaceCardPresentationFromEnv(): ModeratorFaceCardPresentation {
  return {
    username: process.env.MODERATOR_FACE_CARD_USERNAME?.trim() || "Moderator",
    intent: process.env.MODERATOR_FACE_CARD_INTENT?.trim() || "Moderation",
    displayPictureUrl: process.env.MODERATOR_FACE_CARD_DISPLAY_PICTURE_URL?.trim() || "",
    city: process.env.MODERATOR_FACE_CARD_CITY?.trim() || "Beam"
  };
}

export function shouldUseModeratorFaceCard(user: {
  isModerator?: boolean;
  moderatorFaceCardActive?: boolean;
}): boolean {
  return Boolean(user.isModerator && user.moderatorFaceCardActive);
}
