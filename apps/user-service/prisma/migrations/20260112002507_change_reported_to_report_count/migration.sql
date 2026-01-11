-- Change reported Boolean to reportCount Int
-- First, add the new column if it doesn't exist
ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS "reportCount" INTEGER NOT NULL DEFAULT 0;

-- Migrate existing data: if reported was true, set reportCount to 1, otherwise 0
UPDATE users 
  SET "reportCount" = CASE 
    WHEN "reported" = true THEN 1 
    ELSE 0 
  END
  WHERE "reportCount" = 0;

-- Drop the old reported column
ALTER TABLE users 
  DROP COLUMN IF EXISTS "reported";
