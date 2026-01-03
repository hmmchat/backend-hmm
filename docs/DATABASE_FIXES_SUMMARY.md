# Database Fixes Summary

## Changes Made

### 1. Removed `gender_filter_configs` Table ✅

**Issue:** Table stored simple key-value configuration that rarely changes.

**Solution:** Moved to environment variables.

**Changes:**
- Removed `GenderFilterConfig` model from `apps/discovery-service/prisma/schema.prisma`
- Updated `GenderFilterService` to use `ConfigService` and environment variables
- Created migration: `apps/discovery-service/prisma/migrations/20260103000000_remove_gender_filter_configs/migration.sql`
- Updated seed script to remove config seeding
- Updated documentation

**Environment Variables Required:**
```bash
# In apps/discovery-service/.env
GENDER_FILTER_COINS_PER_SCREEN=200
GENDER_FILTER_SCREENS_PER_PURCHASE=10
```

**Default Values:** If not set, defaults to 200 coins and 10 screens.

---

### 2. Removed Redundant `wallets.userId` Column ✅

**Issue:** `wallets.id` already stores the userId, making `wallets.userId` redundant.

**Solution:** Removed `userId` column, use `id` as primary key.

**Changes:**
- Removed `userId` field from `Wallet` model in `apps/wallet-service/prisma/schema.prisma`
- Updated all `wallet.findUnique({ where: { userId } })` to `wallet.findUnique({ where: { id: userId } })`
- Updated all `wallet.create({ data: { id: userId, userId, ... } })` to `wallet.create({ data: { id: userId, ... } })`
- Created migration: `apps/wallet-service/prisma/migrations/20260103000000_remove_userId_column/migration.sql`

**Impact:** No API changes - internal only.

---

### 3. Changed `preferredCities` from Array to Single City ✅

**Issue:** User requirement - only one preferred city, not multiple.

**Solution:** Changed from `TEXT[]` array to nullable `TEXT` string.

**Changes:**
- **Schema:** Changed `preferredCities String[] @default([])` to `preferredCity String?`
- **Migration:** Created migration that:
  1. Adds new `preferredCity` column
  2. Migrates data (takes first city from array if exists)
  3. Drops old `preferredCities` column
- **DTOs:** 
  - Changed `UpdatePreferredCitiesSchema` to `UpdatePreferredCitySchema`
  - Changed `{ cities: string[] }` to `{ city: string | null }`
- **Services:**
  - Updated `updatePreferredCities()` → `updatePreferredCity()`
  - Updated `getPreferredCities()` → `getPreferredCity()`
  - Updated `getCitiesWithMaxUsers()` to use `preferredCity` instead of array operations
- **APIs:**
  - Changed endpoint: `PATCH /me/preferred-cities` → `PATCH /me/preferred-city`
  - Changed response: `{ cities: string[] }` → `{ city: string | null }`
- **Tests:** Updated all test scripts to use single city format
- **Documentation:** Updated frontend integration docs

**Migration Strategy:**
- Takes first city from array if array is not empty
- Sets to `null` if array is empty (default state)

---

## Migration Instructions

### Step 1: Update Environment Variables

Add to `apps/discovery-service/.env`:
```bash
GENDER_FILTER_COINS_PER_SCREEN=200
GENDER_FILTER_SCREENS_PER_PURCHASE=10
```

### Step 2: Run Migrations

```bash
# Discovery Service - Remove gender_filter_configs table
cd apps/discovery-service
npm run prisma:deploy
# OR for development:
npm run prisma:push

# Wallet Service - Remove userId column
cd ../wallet-service
npm run prisma:deploy
# OR for development:
npm run prisma:push

# User Service - Change preferredCities to preferredCity
cd ../user-service
npm run prisma:deploy
# OR for development:
npm run prisma:push
```

### Step 3: Regenerate Prisma Clients

```bash
cd apps/discovery-service && npm run prisma:generate
cd ../wallet-service && npm run prisma:generate
cd ../user-service && npm run prisma:generate
```

### Step 4: Restart Services

Restart all affected services:
- discovery-service
- wallet-service
- user-service

---

## API Changes Summary

### Breaking Changes

1. **Preferred City Endpoint:**
   - **Old:** `PATCH /me/preferred-cities` with `{ cities: string[] }`
   - **New:** `PATCH /me/preferred-city` with `{ city: string | null }`
   - **Response:** Changed from `{ cities: string[] }` to `{ city: string | null }`

2. **Get Preferred City:**
   - **Old:** `GET /location/preference` returns `{ cities: string[] }`
   - **New:** `GET /location/preference` returns `{ city: string | null }`

### Non-Breaking Changes

1. **Gender Filter Config:** No API changes (internal only)
2. **Wallet Service:** No API changes (internal only)

---

## Testing

After migrations, run:
```bash
cd tests/discovery-service
./test-location.sh
```

All tests should pass with the new single city format.

---

## Rollback Plan

If you need to rollback:

1. **Gender Filter Configs:** Re-add the table and update service to use database
2. **Wallet userId:** Re-add the column (though not necessary)
3. **Preferred Cities:** More complex - would need to convert single city back to array

---

## Files Modified

### Discovery Service
- `src/services/gender-filter.service.ts` - Use env vars instead of DB
- `prisma/schema.prisma` - Removed GenderFilterConfig model
- `prisma/seed.ts` - Removed config seeding
- `src/services/location.service.ts` - Single city instead of array
- `src/routes/location.controller.ts` - Updated endpoints
- `src/dtos/location.dto.ts` - Updated DTOs
- `GENDER_FILTER_IMPLEMENTATION.md` - Updated docs

### Wallet Service
- `prisma/schema.prisma` - Removed userId column
- `src/services/wallet.service.ts` - Use id instead of userId

### User Service
- `prisma/schema.prisma` - Changed preferredCities to preferredCity
- `src/services/user.service.ts` - Updated methods and queries
- `src/routes/user.controller.ts` - Updated endpoint
- `src/dtos/profile.dto.ts` - Updated DTOs

### Tests
- `tests/discovery-service/test-location.sh` - Updated for single city

### Documentation
- `docs/for-frontend/FRONTEND_INTEGRATION.md` - Updated API docs
- `docs/for-frontend/FRONTEND_SETUP.md` - Added env vars

---

## Verification Checklist

- [ ] Environment variables added to discovery-service `.env`
- [ ] Migrations run successfully
- [ ] Prisma clients regenerated
- [ ] Services restart without errors
- [ ] Tests pass
- [ ] API endpoints work correctly
- [ ] Documentation updated

---

## Notes

- All changes maintain backward compatibility where possible
- Migration preserves existing data (takes first city from array)
- No data loss expected
- Frontend will need to update to use single city format

