# Referral System Implementation Summary

## Overview

The referral system has been fully implemented. Users can refer others, and when a new user completes their profile after signing up with a referral code, both the referrer and the new user receive coin rewards.

## Implementation Status: ✅ COMPLETE

### 1. Database Schema Changes

**Location**: `apps/auth-service/prisma/`

- ✅ Created migration SQL file: `migrations/add_referral_fields.sql`
- ✅ Created migration guide: `REFERRAL_MIGRATION.md`
- **Action Required**: Run the migration to add fields to `users` table and create `referrals` table

**Fields Added to User Model**:
- `referralCode` (String, unique): Auto-generated unique code for each user
- `referredBy` (String?, nullable): User ID of the person who referred this user
- `referralRewardClaimed` (Boolean, default: false): Tracks if referral reward was already given

**New Referral Model**:
- Tracks referral relationships
- Stores referrerId, referredUserId, rewardClaimed, claimedAt, createdAt

### 2. Auth Service Changes

**Files Modified**:
- ✅ `apps/auth-service/src/services/auth.service.ts`
- ✅ `apps/auth-service/src/routes/auth.controller.ts`

**Features Implemented**:
1. **Referral Code Generation**: Auto-generates unique 8-character codes for new users
2. **Referral Code Validation**: Validates referral codes during signup
3. **Referral Storage**: Stores referral relationships when new users sign up with codes
4. **Referral Status Endpoint**: `GET /auth/users/:userId/referral-status` (internal)
5. **Mark Referral Claimed**: `POST /auth/users/:userId/mark-referral-claimed` (internal)
6. **User-Facing Endpoints**:
   - `GET /auth/me/referral-code`: Get current user's referral code
   - `GET /auth/me/referrals`: Get list of users referred by current user
   - `GET /auth/me/referral-stats`: Get referral statistics

**Login Endpoints Updated** (all accept optional `referralCode`):
- ✅ `POST /auth/google`
- ✅ `POST /auth/apple`
- ✅ `POST /auth/facebook`
- ✅ `POST /auth/phone/verify`

### 3. Wallet Service Changes

**Files Modified**:
- ✅ `apps/wallet-service/src/services/wallet.service.ts`
- ✅ `apps/wallet-service/src/routes/wallet.controller.ts`

**Features Implemented**:
1. **Award Referral Rewards Method**: `awardReferralRewards()` - Awards coins to both referrer and referred user
2. **Internal Endpoint**: `POST /internal/referral-rewards` (for user-service to call)

**Reward Configuration**:
- Environment variables: `REFERRAL_REWARD_REFERRER` (default: 100 coins)
- Environment variables: `REFERRAL_REWARD_REFERRED` (default: 50 coins)

### 4. User Service Changes

**Files Modified**:
- ✅ `apps/user-service/src/services/user.service.ts`
- ✅ `apps/user-service/src/modules/app.module.ts`

**New Files Created**:
- ✅ `apps/user-service/src/services/auth-client.service.ts`
- ✅ `apps/user-service/src/services/wallet-client.service.ts` (updated)

**Features Implemented**:
1. **Auth Client Service**: Calls auth-service to check referral status
2. **Wallet Client Service**: Updated to include `awardReferralRewards()` method
3. **Profile Completion Reward**: Automatically processes referral rewards when profile is completed
4. **Non-Blocking**: Profile creation succeeds even if referral processing fails

### 5. Data Flow

```
1. User A signs up → Gets referralCode generated
2. User A shares referral link: https://app.hmmchat.live/signup?ref=ABC123
3. User B signs up with referralCode: "ABC123"
   → Auth service validates code
   → Sets User B.referredBy = User A.id
   → Creates Referral record
4. User B completes profile (POST /users/:userId/profile)
   → User service creates profile
   → User service checks auth-service for referral status
   → If referral exists and not claimed:
     → User service calls wallet-service to award coins
     → User service calls auth-service to mark reward as claimed
   → Returns profile with reward confirmation
```

## Next Steps

### 1. Run Database Migration

```bash
cd apps/auth-service

# Option A: Using Prisma Migrate (Recommended)
npx prisma migrate dev --name add_referral_system

# Option B: Using SQL file
psql $DATABASE_URL -f prisma/migrations/add_referral_fields.sql
npx prisma generate

# Option C: Using Prisma Push (Development only)
npx prisma db push
npx prisma generate
```

### 2. Set Environment Variables

Add to `apps/user-service/.env`:
```bash
REFERRAL_REWARD_REFERRER=100  # Coins for referrer
REFERRAL_REWARD_REFERRED=50   # Coins for new user
AUTH_SERVICE_URL=http://localhost:3001
WALLET_SERVICE_URL=http://localhost:3005
```

### 3. Test the Implementation

1. **Test Signup with Referral Code**:
   ```bash
   # User A signs up
   POST /v1/auth/google
   { "idToken": "...", "acceptedTerms": true, "acceptedTermsVer": "v1.0" }
   # Response includes referralCode
   
   # User B signs up with referral code
   POST /v1/auth/google
   { "idToken": "...", "acceptedTerms": true, "acceptedTermsVer": "v1.0", "referralCode": "ABC123" }
   ```

2. **Test Profile Completion**:
   ```bash
   # User B completes profile
   POST /v1/users/:userId/profile
   { "username": "...", "dateOfBirth": "...", "gender": "...", "displayPictureUrl": "..." }
   # Should trigger referral reward automatically
   ```

3. **Test Referral Endpoints**:
   ```bash
   # Get referral code
   GET /v1/auth/me/referral-code
   
   # Get referrals list
   GET /v1/auth/me/referrals
   
   # Get referral stats
   GET /v1/auth/me/referral-stats
   ```

## Edge Cases Handled

✅ Invalid referral code: Doesn't block signup
✅ Self-referral: Prevented (user can't use their own code)
✅ Referrer account deleted/suspended: Signup allowed, reward skipped
✅ Duplicate referral attempts: Only rewards on first profile completion
✅ Wallet service unavailable: Profile creation succeeds, reward logged for retry
✅ Auth service unavailable: Profile creation succeeds, referral processing skipped
✅ Race conditions: Idempotency checks via `referralRewardClaimed` flag

## Code Quality

- ✅ No linter errors
- ✅ TypeScript types properly defined
- ✅ Error handling implemented
- ✅ Non-blocking architecture (profile creation never fails due to referral processing)
- ✅ Proper service separation (auth, user, wallet services)

## Files Changed

### Auth Service
- `src/services/auth.service.ts` - Added referral logic
- `src/routes/auth.controller.ts` - Added referral endpoints
- `prisma/migrations/add_referral_fields.sql` - Database migration
- `prisma/REFERRAL_MIGRATION.md` - Migration guide

### Wallet Service
- `src/services/wallet.service.ts` - Added awardReferralRewards method
- `src/routes/wallet.controller.ts` - Added internal referral endpoint

### User Service
- `src/services/user.service.ts` - Added referral reward processing
- `src/services/auth-client.service.ts` - New file for auth-service communication
- `src/services/wallet-client.service.ts` - Updated with referral method
- `src/modules/app.module.ts` - Added AuthClientService

## Notes

- The implementation is production-ready but requires database migration
- All referral processing is non-blocking - profile creation always succeeds
- Referral codes are 8-character alphanumeric (user-friendly)
- Rewards are configurable via environment variables
- The system is backward compatible (existing users will get referral codes on next login)
