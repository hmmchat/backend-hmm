-- Consecutive in-call report multiplier: 2× when previous call also ended with a report.
ALTER TABLE "users" ADD COLUMN "previousCallEndedWithReport" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "lastReportedCallSessionId" TEXT;
