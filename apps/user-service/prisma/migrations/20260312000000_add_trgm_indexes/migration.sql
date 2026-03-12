-- Enable pg_trgm extension for fuzzy text search (safe if already enabled)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram indexes for fuzzy search on catalog tables

-- Brands: fuzzy search on name
CREATE INDEX IF NOT EXISTS "brands_name_trgm_idx"
ON brands
USING gin (lower("name") gin_trgm_ops);

-- Interests: fuzzy search on name
CREATE INDEX IF NOT EXISTS "interests_name_trgm_idx"
ON interests
USING gin (lower("name") gin_trgm_ops);

-- Values: fuzzy search on name
CREATE INDEX IF NOT EXISTS "values_name_trgm_idx"
ON values
USING gin (lower("name") gin_trgm_ops);

