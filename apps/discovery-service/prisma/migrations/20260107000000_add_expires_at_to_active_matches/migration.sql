-- AlterTable: Add expiresAt column to active_matches as nullable first
ALTER TABLE "active_matches" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);

-- Update existing rows: Set expiresAt to createdAt + 60 seconds for existing matches
UPDATE "active_matches" 
SET "expiresAt" = "createdAt" + INTERVAL '60 seconds'
WHERE "expiresAt" IS NULL;

-- Now make it NOT NULL with default
ALTER TABLE "active_matches" 
ALTER COLUMN "expiresAt" SET NOT NULL,
ALTER COLUMN "expiresAt" SET DEFAULT (NOW() + INTERVAL '60 seconds');

-- CreateIndex: Add index on expiresAt for efficient cleanup queries
CREATE INDEX IF NOT EXISTS "active_matches_expiresAt_idx" ON "active_matches"("expiresAt");
