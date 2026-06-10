-- Presence: track last app activity and default new users to OFFLINE.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lastActiveAt" TIMESTAMP(3);

ALTER TABLE "users" ALTER COLUMN "status" SET DEFAULT 'OFFLINE';
