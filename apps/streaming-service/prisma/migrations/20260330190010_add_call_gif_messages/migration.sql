-- Create CallMessageType enum if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CallMessageType') THEN
    CREATE TYPE "CallMessageType" AS ENUM ('TEXT', 'GIF', 'GIF_WITH_MESSAGE');
  END IF;
END $$;

-- Add columns for GIF messages
ALTER TABLE "call_messages"
  ADD COLUMN IF NOT EXISTS "messageType" "CallMessageType" NOT NULL DEFAULT 'TEXT',
  ADD COLUMN IF NOT EXISTS "gifProvider" TEXT,
  ADD COLUMN IF NOT EXISTS "gifId" TEXT,
  ADD COLUMN IF NOT EXISTS "gifUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "gifPreviewUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "gifWidth" INTEGER,
  ADD COLUMN IF NOT EXISTS "gifHeight" INTEGER;

-- Allow null message for gif-only (optional but matches prisma schema)
ALTER TABLE "call_messages"
  ALTER COLUMN "message" DROP NOT NULL;

