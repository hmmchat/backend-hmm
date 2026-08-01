-- Report revamp: exponential streak points + critical review pool flags.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lastAppliedReportPoints" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "criticalReviewActive" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "criticalReviewReason" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "criticalReviewAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "users_criticalReviewActive_idx" ON "users"("criticalReviewActive");
