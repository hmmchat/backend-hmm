-- Squad inbox message types + optional JSON meta on friend_messages

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'MessageType' AND e.enumlabel = 'SQUAD_INVITE'
  ) THEN
    ALTER TYPE "MessageType" ADD VALUE 'SQUAD_INVITE';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'MessageType' AND e.enumlabel = 'SQUAD_INVITE_OUTCOME'
  ) THEN
    ALTER TYPE "MessageType" ADD VALUE 'SQUAD_INVITE_OUTCOME';
  END IF;
END $$;

ALTER TABLE "friend_messages" ADD COLUMN IF NOT EXISTS "squadMeta" TEXT;
