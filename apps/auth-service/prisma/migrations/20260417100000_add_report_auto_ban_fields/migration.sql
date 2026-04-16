-- Report-threshold auto-ban fields (see auth.service banAccount reportAutoBan).
-- Use current_schema() (e.g. auth_service from DATABASE_URL ?schema=auth_service), not public.
-- Supports Prisma default table "User" or legacy lowercase "users" in that same schema.
DO $$
DECLARE
  sch text := current_schema();
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = sch AND c.relkind = 'r' AND c.relname = 'User'
  ) THEN
    EXECUTE format(
      'ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS "reportAutoBanActive" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS "reportBanNoLoginUntil" TIMESTAMP(3)',
      sch,
      'User'
    );
  ELSIF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = sch AND c.relkind = 'r' AND c.relname = 'users'
  ) THEN
    EXECUTE format(
      'ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS "reportAutoBanActive" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS "reportBanNoLoginUntil" TIMESTAMP(3)',
      sch,
      'users'
    );
  ELSE
    RAISE EXCEPTION 'auth migration: no "User" or users table in schema %', sch;
  END IF;
END $$;
