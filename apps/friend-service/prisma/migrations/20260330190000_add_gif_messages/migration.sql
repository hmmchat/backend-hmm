-- Add enum values for GIF messages
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MessageType') THEN
    RAISE EXCEPTION 'Expected enum type "MessageType" to exist';
  END IF;
END $$;

ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'GIF';
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'GIF_WITH_MESSAGE';

-- Add GIF metadata columns to friend_messages
ALTER TABLE "friend_messages"
  ADD COLUMN IF NOT EXISTS "gifProvider" TEXT,
  ADD COLUMN IF NOT EXISTS "gifId" TEXT,
  ADD COLUMN IF NOT EXISTS "gifUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "gifPreviewUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "gifWidth" INTEGER,
  ADD COLUMN IF NOT EXISTS "gifHeight" INTEGER;

