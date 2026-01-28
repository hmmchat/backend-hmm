# Referral System Migration Guide

## Overview

This migration adds referral functionality to the auth-service. It requires:
1. Adding fields to the `users` table
2. Creating a new `referrals` table

## Step 1: Update Prisma Schema

Add the following to `apps/auth-service/prisma/schema.prisma`:

```prisma
model User {
  // ... existing fields ...
  referralCode      String   @unique @default(cuid())
  referredBy        String?
  referralRewardClaimed Boolean @default(false)
  // ... rest of fields ...
  
  // Add relation (optional, for Prisma queries)
  referrals Referral[] @relation("Referrer")
  referredReferral Referral? @relation("Referred")
}

model Referral {
  id            String   @id @default(cuid())
  referrerId    String
  referredUserId String  @unique
  rewardClaimed Boolean  @default(false)
  claimedAt     DateTime?
  createdAt     DateTime @default(now())
  
  referrer User @relation("Referrer", fields: [referrerId], references: [id], onDelete: Cascade)
  referredUser User @relation("Referred", fields: [referredUserId], references: [id], onDelete: Cascade)
  
  @@index([referrerId])
  @@index([referredUserId])
  @@map("referrals")
}
```

## Step 2: Run Migration

### Option A: Using Prisma Migrate (Recommended)

```bash
cd apps/auth-service
npx prisma migrate dev --name add_referral_system
```

### Option B: Using SQL Migration

```bash
cd apps/auth-service
psql $DATABASE_URL -f prisma/migrations/add_referral_fields.sql
npx prisma generate
```

### Option C: Using Prisma Push (Development Only)

```bash
cd apps/auth-service
npx prisma db push
npx prisma generate
```

## Step 3: Verify Migration

After migration, verify the changes:

```sql
-- Check users table has new columns
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'users' 
AND column_name IN ('referralCode', 'referredBy', 'referralRewardClaimed');

-- Check referrals table exists
SELECT * FROM information_schema.tables WHERE table_name = 'referrals';
```

## Step 4: Generate Prisma Client

```bash
cd apps/auth-service
npx prisma generate
```

## Notes

- Existing users will get referral codes generated automatically
- The migration is backward compatible (all new fields are nullable or have defaults)
- Referral codes are unique 8-character alphanumeric strings (fallback to longer codes if needed)
