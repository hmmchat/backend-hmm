-- Add domain and brandfetch fields to brands table
ALTER TABLE brands 
  ADD COLUMN IF NOT EXISTS "domain" TEXT,
  ADD COLUMN IF NOT EXISTS "brandfetchId" TEXT;

-- Add updatedAt with default for existing rows
ALTER TABLE brands 
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP;

-- Set default for existing rows
UPDATE brands 
  SET "updatedAt" = COALESCE("updatedAt", NOW(), CURRENT_TIMESTAMP)
  WHERE "updatedAt" IS NULL;

-- Make updatedAt NOT NULL with default
ALTER TABLE brands 
  ALTER COLUMN "updatedAt" SET DEFAULT NOW(),
  ALTER COLUMN "updatedAt" SET NOT NULL;

-- Create index on domain for faster lookups
CREATE INDEX IF NOT EXISTS "brands_domain_idx" ON brands("domain");
