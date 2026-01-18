-- Add VIEWER status to UserStatus enum (replaces WATCHING_HMM_TV)
ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'VIEWER';

-- Migrate any existing users with WATCHING_HMM_TV status to VIEWER
-- Using ::text cast to handle the old enum value that may no longer exist in Prisma schema
UPDATE "users" 
SET status = 'VIEWER'::"UserStatus"
WHERE status::text = 'WATCHING_HMM_TV';
