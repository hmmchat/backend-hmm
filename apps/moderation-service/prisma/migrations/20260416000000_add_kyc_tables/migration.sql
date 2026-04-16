DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'KycDecision') THEN
    CREATE TYPE "KycDecision" AS ENUM ('VERIFIED', 'REJECTED', 'REVIEW', 'REVOKED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "kyc_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "moderatorId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "decision" "KycDecision",
    "decisionReason" TEXT,
    "reportCount" INTEGER NOT NULL DEFAULT 0,
    "kycRiskScore" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kyc_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "kyc_feedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "questionOne" TEXT NOT NULL,
    "questionTwo" TEXT NOT NULL,
    "rewardedCoins" INTEGER NOT NULL DEFAULT 0,
    "rewardIssued" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kyc_feedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "kyc_sessions_userId_createdAt_idx" ON "kyc_sessions"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "kyc_sessions_moderatorId_createdAt_idx" ON "kyc_sessions"("moderatorId", "createdAt");
CREATE INDEX IF NOT EXISTS "kyc_sessions_decision_idx" ON "kyc_sessions"("decision");
CREATE INDEX IF NOT EXISTS "kyc_feedback_userId_createdAt_idx" ON "kyc_feedback"("userId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'kyc_feedback_userId_sessionId_key'
  ) THEN
    ALTER TABLE "kyc_feedback"
      ADD CONSTRAINT "kyc_feedback_userId_sessionId_key" UNIQUE ("userId", "sessionId");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'kyc_feedback_sessionId_fkey'
  ) THEN
    ALTER TABLE "kyc_feedback"
      ADD CONSTRAINT "kyc_feedback_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "kyc_sessions"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
