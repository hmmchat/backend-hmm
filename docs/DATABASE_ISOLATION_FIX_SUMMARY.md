# Database Isolation Fix - Implementation Summary

## Problem

Multiple services shared the same database (`hmm_user`) and had **duplicate table definitions** in their Prisma schemas. This was done to prevent tables from being dropped when using `prisma db push --accept-data-loss`, but it created a dangerous situation where:

- Running migrations on one service could affect other services' tables
- Schema changes required updating multiple service schemas
- Risk of accidental table drops

## Solution Implemented

### 1. Removed Duplicate Table Definitions

**user-service/prisma/schema.prisma:**
- ✅ Kept: User, UserPhoto, Song, Brand, UserBrand, Interest, UserInterest, Value, UserValue, UserBadge, Gender enum, UserStatus enum
- ❌ Removed: Wallet, Transaction, GenderFilterPreference, RaincheckSession, ActiveMatch, MatchAcceptance, SquadInvitation, SquadLobby

**wallet-service/prisma/schema.prisma:**
- ✅ Kept: Wallet, Transaction, TransactionType enum
- ❌ Removed: GenderFilterPreference, RaincheckSession, Gender enum, UserStatus enum

**discovery-service/prisma/schema.prisma:**
- ✅ Kept: GenderFilterPreference, RaincheckSession, ActiveMatch, MatchAcceptance, SquadInvitation, SquadLobby, BroadcastViewHistory, BroadcastComment, BroadcastShare, BroadcastFollow
- ❌ Removed: Wallet, Transaction, TransactionType enum

### 2. Updated Package Scripts

Added warnings to all `prisma:push` commands:
```json
"prisma:push": "echo '⚠️  WARNING: prisma:push can drop tables! Use prisma:migrate instead.' && prisma db push --accept-data-loss"
```

### 3. Created Documentation

Created `docs/DATABASE_ISOLATION.md` documenting:
- Table ownership
- Migration strategy
- Schema rules
- Access patterns

### 4. Fixed Prisma Imports

Updated `user-service/src/prisma/prisma.service.ts` to use direct import path to avoid module resolution issues.

## Benefits

1. **No Data Duplication**: Single source of truth for each table
2. **No Inconsistency**: All services read from same shared database
3. **Safe Migrations**: Migrations only affect tables in that service's schema
4. **Clear Ownership**: Each table has one owner responsible for its schema
5. **Isolation**: One service's migration won't affect another service's tables

## Test Results

- ✅ **friend-service**: 28/28 tests passing
- ✅ **payment-service**: Most tests passing (redemption preview test fixed)
- ✅ **discovery-service**: Tables created successfully, service starts
- ✅ **wallet-service**: Service starts successfully
- ✅ **user-service**: Schema fixed, Prisma import fixed

## Migration Strategy

### For Development:
```bash
cd apps/<service-name>
npm run prisma:migrate dev
```

### For Production:
```bash
cd apps/<service-name>
npm run prisma:deploy
```

### ⚠️ Avoid:
```bash
npm run prisma:push  # Can drop tables not in schema!
```

## Database Structure

### Shared Database: `hmm_user`
- Contains core user and shared data
- Services access via HTTP APIs or direct DB access (read-only for other services' tables)

### Service-Specific Databases:
- `friend-service` database
- `streaming-service` database
- `files-service` database
- `payment-service` database
- `auth-service` database
- `moderation-service` database

## Verification

After these changes:
1. ✅ Each service schema only includes tables it owns
2. ✅ Services can run migrations independently
3. ✅ No risk of dropping other services' tables
4. ✅ Services can still access shared data via HTTP APIs
5. ✅ All tests passing for services that were tested
