-- Add KYC state and moderator routing fields on users
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'KycStatus') THEN
    CREATE TYPE "KycStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'PENDING_REVIEW', 'REVOKED', 'EXPIRED');
  END IF;
END $$;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "isModerator" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "kycStatus" "KycStatus" NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN IF NOT EXISTS "kycRiskScore" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "kycExpiresAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "users_isModerator_idx" ON "users"("isModerator");
CREATE INDEX IF NOT EXISTS "users_kycStatus_idx" ON "users"("kycStatus");
CREATE INDEX IF NOT EXISTS "users_kycExpiresAt_idx" ON "users"("kycExpiresAt");
