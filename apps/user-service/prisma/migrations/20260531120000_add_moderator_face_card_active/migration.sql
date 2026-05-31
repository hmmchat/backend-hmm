-- When true (and isModerator), discovery shows the shared moderator face card instead of personal profile.
ALTER TABLE "users" ADD COLUMN "moderatorFaceCardActive" BOOLEAN NOT NULL DEFAULT false;
