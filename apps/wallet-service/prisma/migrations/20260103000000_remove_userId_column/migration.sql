-- Remove redundant userId column from wallets table
-- id already stores the userId, so userId column is redundant
ALTER TABLE "wallets" DROP COLUMN IF EXISTS "userId";
DROP INDEX IF EXISTS "wallets_userId_key";

