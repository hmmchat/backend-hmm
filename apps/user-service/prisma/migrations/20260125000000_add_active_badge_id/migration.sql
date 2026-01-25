-- Add activeBadgeId column to users table
-- This column stores the currently selected badge ID for a user
-- Nullable because users may not have selected a badge yet

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "activeBadgeId" TEXT;

-- Note: No foreign key constraint needed - activeBadgeId references user_badges.giftId
-- which is not a primary key, so we handle the relationship in application code
