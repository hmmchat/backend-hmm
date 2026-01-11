# Payment Service E2E Tests

Comprehensive end-to-end tests for payment service that can run **without any payment gateway keys or credentials**.

## Overview

These tests verify:
- Payment calculation logic (coins, diamonds, INR conversions)
- Upsell calculations and multipliers
- Redemption preview with upsell options
- Validation logic (minimum amounts, insufficient balance, etc.)
- Configuration retrieval
- Health check endpoint

## Requirements

- Payment service running on `http://localhost:3008` (or set `PAYMENT_SERVICE_URL` env var)
- PostgreSQL running (for database health check)
- `jq` installed (for JSON parsing)
- `curl` installed

**No Razorpay keys or credentials required!**

## Running Tests

### Option 1: Start Service Manually

```bash
# Terminal 1: Start payment service in test mode (no keys required)
cd tests/payment-service
./start-local-server.sh

# Terminal 2: Run tests
cd tests/payment-service
./test-payment-e2e.sh
```

### Option 2: Start Service Manually (Alternative)

```bash
# Terminal 1: Start payment service with test mode enabled
cd apps/payment-service
export ALLOW_TEST_MODE=true
export DATABASE_URL="postgresql://user:pass@localhost:5432/hmm_payment"
export PAYMENT_ENCRYPTION_KEY="test-encryption-key-32-chars-long-for-testing-only"
npm run start:dev

# Terminal 2: Run tests
cd tests/payment-service
./test-payment-e2e.sh
```

**Note:** In test mode, Razorpay keys are optional - the service will start with dummy values. Only calculation and test endpoints will work.

## Test Endpoints Used

All test endpoints are under `/v1/payments/test/*` and bypass authentication:

- `GET /v1/payments/test/config` - Get payment configuration
- `POST /v1/payments/test/calculate/coins` - Calculate coins for INR
- `POST /v1/payments/test/calculate/inr` - Calculate INR for coins
- `POST /v1/payments/test/calculate/diamonds` - Convert coins to diamonds
- `POST /v1/payments/test/calculate/diamond-inr` - Calculate INR for diamonds
- `POST /v1/payments/test/calculate/upsell` - Calculate upsell value
- `POST /v1/payments/test/redemption/preview` - Preview redemption with upsell (no wallet service required)

## Test Coverage

### Configuration Tests
- ✅ Configuration retrieval
- ✅ All rates and multipliers

### Calculation Tests
- ✅ INR → Coins conversion
- ✅ Coins → INR conversion
- ✅ Coins → Diamonds conversion
- ✅ Diamonds → INR conversion (base rate)
- ✅ Round-trip conversions

### Upsell Tests
- ✅ Upsell level 0 (no upsell)
- ✅ Upsell levels 1-3
- ✅ Multiplier calculations
- ✅ Upsell options generation
- ✅ Progressive value increases

### Validation Tests
- ✅ Minimum redemption amount
- ✅ Insufficient diamonds
- ✅ Negative amounts
- ✅ Zero amounts
- ✅ Missing required fields

### Health & Infrastructure
- ✅ Health check endpoint
- ✅ Invalid endpoint handling

## Example Output

```
==========================================
  PAYMENT SERVICE E2E TEST (NO KEYS)
==========================================

Step 1: Checking Infrastructure...
✅ PostgreSQL is running

Step 2: Checking Payment Service...
✅ Payment service is running

==========================================
  TEST CASES
==========================================

✅ PASS: Configuration retrieved (INR/Coin: 0.01, Diamond/Coin: 50, Diamond/INR: 0.4)
✅ PASS: Coins calculation successful (₹100 = 10000 coins)
✅ PASS: Upsell level 1 calculation successful (₹160)
...

==========================================
  TEST SUMMARY
==========================================
Passed: 17
Failed: 0

✅ All tests passed!
```

## Notes

- Tests don't require actual Razorpay integration
- Tests don't require wallet service to be running
- Tests verify calculation logic only (no actual transactions)
- All sensitive operations are tested via calculation endpoints
