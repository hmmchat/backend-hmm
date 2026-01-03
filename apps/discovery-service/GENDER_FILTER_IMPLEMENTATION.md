# Gender Filter Implementation Summary

## What Was Implemented

### 1. Database Schema (Prisma)
- **Location:** `apps/discovery-service/prisma/schema.prisma`
- **Models:**
  - `GenderFilterPreference`: Stores user's gender filter preferences and remaining screens
  - ~~`GenderFilterConfig`~~: Removed - pricing now configured via environment variables
- **Migration:** `prisma/migrations/20260102000000_init_gender_filter/`

### 2. Services Created

#### GenderFilterService (`src/services/gender-filter.service.ts`)
- `getGenderFilters()`: Returns available filters based on user gender
- `applyGenderFilter()`: Purchases and activates gender filter
- `decrementScreen()`: Decrements remaining screens when user views a match
- `getCurrentPreference()`: Gets user's current filter preference

#### WalletClientService (`src/services/wallet-client.service.ts`)
- `getBalance()`: Gets user's wallet balance
- `deductCoinsForGenderFilter()`: Deducts coins for gender filter purchase

#### UserClientService (Updated)
- Added `getUserProfile()`: Fetches user profile with gender information

### 3. API Endpoints

#### GET `/gender-filters`
- Returns available gender filters based on user's gender
- Handles PREFER_NOT_TO_SAY users (returns `applicable: false`)
- Returns different filter options for MALE/FEMALE vs NON_BINARY users

#### POST `/gender-filters/apply`
- Purchases and activates gender filter
- Validates user can use filter
- Validates selected genders based on user's gender
- Deducts coins from wallet
- Creates/updates filter preference

### 4. Wallet Service Updates

#### New Endpoint: POST `/me/transactions/gender-filter`
- Deducts coins for gender filter purchase
- Creates transaction record
- Returns new balance and transaction ID

#### New Method: `deductCoinsForGenderFilter()`
- Validates balance
- Deducts coins
- Creates transaction

### 5. Test Coverage

#### Test Script: `tests/discovery-service/test-discovery-service.sh`
- Metrics endpoint tests (existing)
- Gender filter endpoint tests:
  - Get filters without token (401)
  - Get filters with invalid token (401)
  - Get filters for PREFER_NOT_TO_SAY user (disabled)
  - Get filters for MALE user (2 options)
  - Get filters for FEMALE user (2 options)
  - Get filters for NON_BINARY user (3 options)
  - Apply gender filter (purchase)
  - Apply filter with invalid selection (400)
  - Apply filter without token (401)

### 6. Seed Data

#### Seed Script: `prisma/seed.ts`
- Seeds test preferences for testing
- Note: Configuration is now via environment variables, not database

## Business Rules Implemented

1. **PREFER_NOT_TO_SAY users**: Filter is disabled with reason message
2. **MALE/FEMALE users**: Can only see and filter by MALE and FEMALE (2 options)
3. **NON_BINARY users**: Can see and filter by all 3 options (MALE, FEMALE, NON_BINARY)
4. **Pricing**: Configurable via environment variables (default: 200 coins, 10 screens)

## Configuration

Pricing is configurable via environment variables:
- `GENDER_FILTER_COINS_PER_SCREEN`: Cost in coins (default: 200)
- `GENDER_FILTER_SCREENS_PER_PURCHASE`: Number of screens per purchase (default: 10)

Add these to your `.env` file in `apps/discovery-service/`:
```bash
GENDER_FILTER_COINS_PER_SCREEN=200
GENDER_FILTER_SCREENS_PER_PURCHASE=10
```

## Next Steps to Run

1. **Install dependencies:**
   ```bash
   cd apps/discovery-service
   npm install
   ```

2. **Apply migrations:**
   ```bash
   npm run prisma:deploy
   # OR for development:
   npm run prisma:push
   ```

3. **Generate Prisma client:**
   ```bash
   npm run prisma:generate
   ```

4. **Seed test data:**
   ```bash
   npm run prisma:seed
   ```

5. **Run tests:**
   ```bash
   cd tests/discovery-service
   ./test-discovery-service.sh
   ```

## Architecture

- **discovery-service**: Handles gender filter logic, preferences storage, API endpoints
- **user-service**: Provides user gender information
- **wallet-service**: Handles coin deductions and transaction recording

## API Request Examples

### Get Available Filters
```bash
curl -X GET http://localhost:3004/gender-filters \
  -H "Authorization: Bearer <token>"
```

### Apply Gender Filter
```bash
curl -X POST http://localhost:3004/gender-filters/apply \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"genders": ["MALE", "FEMALE"]}'
```

## Files Created/Modified

### Created:
- `apps/discovery-service/prisma/schema.prisma`
- `apps/discovery-service/prisma/migrations/20260102000000_init_gender_filter/migration.sql`
- `apps/discovery-service/prisma/seed.ts`
- `apps/discovery-service/src/prisma/prisma.service.ts`
- `apps/discovery-service/src/services/gender-filter.service.ts`
- `apps/discovery-service/src/services/wallet-client.service.ts`
- `apps/discovery-service/src/routes/gender-filter.controller.ts`
- `apps/discovery-service/scripts/postinstall-prisma.js`
- `tests/discovery-service/test-discovery-service.sh` (updated)
- `tests/discovery-service/README.md`
- `tests/discovery-service/SETUP.md`

### Modified:
- `apps/discovery-service/src/services/user-client.service.ts`
- `apps/discovery-service/src/modules/app.module.ts`
- `apps/discovery-service/package.json`
- `apps/wallet-service/src/services/wallet.service.ts`
- `apps/wallet-service/src/routes/wallet.controller.ts`

