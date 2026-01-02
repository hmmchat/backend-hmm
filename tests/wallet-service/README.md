# Wallet Service Tests

Test scripts and documentation for wallet-service.

## Test Scripts

### `test-wallet-service.sh`

Comprehensive test script for wallet-service balance endpoint.

**Prerequisites:**
- Auth service running on port 3001 (for getting access tokens)
- Wallet service running on port 3005 (or will be started automatically)
- PostgreSQL running (wallet-service needs database)

**Usage:**
```bash
cd tests/wallet-service

# Option 1: Run without token (will test authentication requirements only)
./test-wallet-service.sh

# Option 2: Run with access token (full test suite)
export ACCESS_TOKEN='your_access_token_here'
./test-wallet-service.sh
```

**Getting an Access Token:**
See `tests/auth-service/HOW_TO_GET_TOKENS.md` for instructions on how to get an access token from auth-service.

**Tests Included:**
1. Authentication requirement (401 without token)
2. Get balance with valid token
3. Response format validation
4. Lazy wallet initialization (wallet created automatically)
5. Balance consistency across multiple requests
6. Error handling (invalid token, missing header, invalid endpoints)

**What it tests:**
- `/me/balance` endpoint requires authentication
- Response format: `{ "balance": number }`
- Balance is always non-negative integer
- Wallet is automatically created if it doesn't exist (lazy initialization)
- Initial balance is 0 for new wallets

## Balance Endpoint

### GET /me/balance

Returns the current coin balance for the authenticated user.

**Authentication:** Required (Bearer token)

**Response:**
```json
{
  "balance": 25500
}
```

**Features:**
- **Lazy Initialization:** Wallet is automatically created with 0 balance if it doesn't exist
- **Non-negative Balance:** Balance is always a non-negative integer
- **User-specific:** Each user has their own wallet

## Test Coverage

### Authentication Tests
- ✅ Requires valid access token (401 without token)
- ✅ Rejects invalid token formats
- ✅ Requires Authorization header

### Functionality Tests
- ✅ Returns balance in correct format
- ✅ Balance is non-negative integer
- ✅ Wallet created automatically (lazy initialization)
- ✅ Initial balance is 0 for new wallets
- ✅ Balance is consistent across requests

### Error Handling Tests
- ✅ Invalid endpoints return 404
- ✅ Missing authentication returns 401
- ✅ Invalid tokens are rejected

## Running Tests Manually

### With cURL

```bash
# Set your access token
export ACCESS_TOKEN="your_token_here"

# Get balance
curl http://localhost:3005/me/balance \
  -H "Authorization: Bearer $ACCESS_TOKEN"

# Expected response:
# {"balance": 25500}
```

### Without Token (should fail)

```bash
curl http://localhost:3005/me/balance

# Expected response:
# 401 Unauthorized
```

## Notes

- Wallet-service uses lazy initialization - wallets are created automatically when first accessed
- All users start with a balance of 0 coins
- Balance is stored as an integer in the database
- The service requires authentication for all endpoints

