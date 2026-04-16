-- Report-moderation discovery: limit pool to moderators after auto-ban lockout (user-service flag).
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "reportModeratorCardsOnly" BOOLEAN NOT NULL DEFAULT false;
