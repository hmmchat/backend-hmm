-- Add diamonds column to gifts (cost in diamonds for gifting)
-- Safe when table does not exist yet (no-op)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'gifts') THEN
    ALTER TABLE "gifts" ADD COLUMN IF NOT EXISTS "diamonds" INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;
