ALTER TABLE "ad_rewards"
  ADD COLUMN IF NOT EXISTS "providerTransactionId" TEXT,
  ADD COLUMN IF NOT EXISTS "providerProofHash" TEXT,
  ADD COLUMN IF NOT EXISTS "transactionId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "ad_rewards_adNetwork_providerTransactionId_key"
  ON "ad_rewards" ("adNetwork", "providerTransactionId");
