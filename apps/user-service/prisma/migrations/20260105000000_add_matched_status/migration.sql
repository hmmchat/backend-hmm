-- Add MATCHED status to UserStatus enum
ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'MATCHED';

