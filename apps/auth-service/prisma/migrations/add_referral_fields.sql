-- Migration: Add referral fields to User model and create Referral model
-- Run this migration using: psql $DATABASE_URL -f add_referral_fields.sql

-- Add referral fields to users table
ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS "referralCode" TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS "referredBy" TEXT,
  ADD COLUMN IF NOT EXISTS "referralRewardClaimed" BOOLEAN DEFAULT false;

-- Create index on referralCode for faster lookups
CREATE INDEX IF NOT EXISTS "users_referralCode_idx" ON users("referralCode");

-- Create index on referredBy for faster queries
CREATE INDEX IF NOT EXISTS "users_referredBy_idx" ON users("referredBy");

-- Generate referral codes for existing users (if any)
-- Using a simple approach: REF + timestamp + random
UPDATE users 
SET "referralCode" = 'REF' || UPPER(TO_HEX(FLOOR(RANDOM() * 4294967295)::bigint)) || UPPER(SUBSTRING(MD5(id::text) FROM 1 FOR 5))
WHERE "referralCode" IS NULL;

-- Create referrals table
CREATE TABLE IF NOT EXISTS referrals (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "referrerId" TEXT NOT NULL,
  "referredUserId" TEXT NOT NULL UNIQUE,
  "rewardClaimed" BOOLEAN NOT NULL DEFAULT false,
  "claimedAt" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create indexes on referrals table
CREATE INDEX IF NOT EXISTS "referrals_referrerId_idx" ON referrals("referrerId");
CREATE INDEX IF NOT EXISTS "referrals_referredUserId_idx" ON referrals("referredUserId");

-- Add foreign key constraints (optional, for data integrity)
-- Note: These may fail if referrerId or referredUserId don't exist in users table
-- ALTER TABLE referrals ADD CONSTRAINT "referrals_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES users(id) ON DELETE CASCADE;
-- ALTER TABLE referrals ADD CONSTRAINT "referrals_referredUserId_fkey" FOREIGN KEY ("referredUserId") REFERENCES users(id) ON DELETE CASCADE;
