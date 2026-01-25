-- Make expiresAt nullable to match Prisma schema
-- The Prisma schema defines expiresAt as DateTime? (nullable)
-- But the previous migration made it NOT NULL, causing constraint violations

-- Step 1: Remove the NOT NULL constraint and default
ALTER TABLE "active_matches" 
ALTER COLUMN "expiresAt" DROP NOT NULL,
ALTER COLUMN "expiresAt" DROP DEFAULT;

-- Step 2: Update any existing rows that might have been set to the default
-- (This is safe - we're just ensuring consistency)
-- No UPDATE needed since we're making it nullable
