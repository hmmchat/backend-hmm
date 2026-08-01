-- Permanent ban flag (no timed unlock). Supports Prisma "User" or legacy "users".
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
      'ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS "permanentBan" BOOLEAN NOT NULL DEFAULT false',
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
      'ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS "permanentBan" BOOLEAN NOT NULL DEFAULT false',
      sch,
      'users'
    );
  ELSE
    RAISE EXCEPTION 'auth migration: no "User" or users table in schema %', sch;
  END IF;
END $$;
