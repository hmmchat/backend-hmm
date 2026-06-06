-- Allow multiple sticker instances per gift type; track expiry per instance.
ALTER TABLE "user_badges" DROP CONSTRAINT IF EXISTS "user_badges_userId_giftId_key";

ALTER TABLE "user_badges" ADD COLUMN IF NOT EXISTS "walletTransactionId" TEXT;
ALTER TABLE "user_badges" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);

UPDATE "user_badges"
SET "expiresAt" = "receivedAt" + INTERVAL '7 days'
WHERE "expiresAt" IS NULL;

ALTER TABLE "user_badges" ALTER COLUMN "expiresAt" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "user_badges_walletTransactionId_key"
  ON "user_badges"("walletTransactionId")
  WHERE "walletTransactionId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "user_badges_userId_expiresAt_idx"
  ON "user_badges"("userId", "expiresAt");
