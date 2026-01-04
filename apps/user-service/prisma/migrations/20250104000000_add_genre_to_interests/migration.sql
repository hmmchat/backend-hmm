-- Add genre field to interests table
-- genre is the umbrella category (e.g., "sports", "web series")
-- name is the sub-genre (e.g., "cricket", "hockey", "sitcoms", "romcoms")

-- Step 1: Add genre column (nullable initially for existing data)
ALTER TABLE "interests" ADD COLUMN IF NOT EXISTS "genre" TEXT;

-- Step 2: Create index on genre for faster queries
CREATE INDEX IF NOT EXISTS "interests_genre_idx" ON "interests"("genre");

-- Note: Existing interests will have NULL genre values
-- These should be updated manually or via a data migration script
-- when uploading the interest sample space with genre information

