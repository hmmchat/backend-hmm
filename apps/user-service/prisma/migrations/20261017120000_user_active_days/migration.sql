-- One row per user per IST day the app was open. Powers next-day return.
CREATE TABLE IF NOT EXISTS "user_active_days" (
  "userId" TEXT NOT NULL,
  "day" DATE NOT NULL,
  CONSTRAINT "user_active_days_pkey" PRIMARY KEY ("userId", "day")
);

CREATE INDEX IF NOT EXISTS "user_active_days_day_idx" ON "user_active_days"("day");
