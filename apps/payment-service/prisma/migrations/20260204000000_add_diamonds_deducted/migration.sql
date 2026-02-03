-- Add diamondsDeducted to redemption_requests (new decoupled flow)
-- Safe when table does not exist yet (no-op)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'redemption_requests') THEN
    ALTER TABLE "redemption_requests" ADD COLUMN IF NOT EXISTS "diamondsDeducted" INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;
