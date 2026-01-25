-- Add VIEWER status to UserStatus enum (replaces WATCHING_HMM_TV)
-- Note: UPDATE moved to next migration; PG disallows using new enum value in same transaction
ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'VIEWER';
