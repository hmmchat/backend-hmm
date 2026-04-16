-- Report-threshold auto-ban: timed login block + post-lockout moderation (see auth.service banAccount reportAutoBan).
-- Table name: Prisma default is "User"; some deployments use legacy public.users (see prisma/migrations/add_referral_fields.sql).
DO $$
BEGIN
  IF to_regclass('public."User"') IS NOT NULL THEN
    ALTER TABLE "User"
      ADD COLUMN IF NOT EXISTS "reportAutoBanActive" BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "reportBanNoLoginUntil" TIMESTAMP(3);
  ELSIF to_regclass('public.users') IS NOT NULL THEN
    ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "reportAutoBanActive" BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "reportBanNoLoginUntil" TIMESTAMP(3);
  ELSE
    RAISE EXCEPTION 'auth migration: neither public."User" nor public.users exists';
  END IF;
END $$;
