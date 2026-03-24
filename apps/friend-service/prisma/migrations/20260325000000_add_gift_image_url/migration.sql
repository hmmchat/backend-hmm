-- Optional image URL/path for gift stickers (UUID giftIds are not valid filenames)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'gifts') THEN
    ALTER TABLE "gifts" ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;
  END IF;
END $$;
