-- Change preferredCities from array to single preferredCity string
-- Migration strategy:
-- 1. Add new preferredCity column (nullable)
-- 2. Migrate data: take first city from array if exists
-- 3. Drop old preferredCities column

-- Step 1: Add new preferredCity column
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "preferredCity" TEXT;

-- Step 2: Migrate data - take first city from array if array is not empty
UPDATE "users"
SET "preferredCity" = (
  SELECT unnest("preferredCities") 
  LIMIT 1
)
WHERE array_length("preferredCities", 1) > 0
  AND "preferredCity" IS NULL;

-- Step 3: Drop old preferredCities column
ALTER TABLE "users" DROP COLUMN IF EXISTS "preferredCities";

