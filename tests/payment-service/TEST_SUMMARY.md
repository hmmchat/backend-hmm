# Payment Service Test Summary

## Test Coverage

The test suite (`test-payment-e2e.sh`) covers **17 test cases** that can run **without any payment gateway keys or credentials**.

### Test Categories

#### 1. Configuration Tests (1 test)
- ✅ Get payment configuration (rates, multipliers, limits)

#### 2. Calculation Tests (5 tests)
- ✅ Calculate coins for INR amount
- ✅ Calculate INR for coins amount
- ✅ Calculate diamonds from coins
- ✅ Calculate INR for diamonds (base rate)
- ✅ Round-trip conversion test

#### 3. Upsell Tests (3 tests)
- ✅ Upsell level 1 calculation
- ✅ Multiple upsell levels (0, 1, 2, 3)
- ✅ Upsell multiplier progression

#### 4. Redemption Preview Tests (2 tests)
- ✅ Preview redemption with upsell options
- ✅ Upsell options generation

#### 5. Validation Tests (5 tests)
- ✅ Minimum redemption validation
- ✅ Insufficient diamonds validation
- ✅ Negative amount validation
- ✅ Zero amount validation
- ✅ Missing required fields validation

#### 6. Infrastructure Tests (2 tests)
- ✅ Health check endpoint
- ✅ Invalid endpoint handling (404)

## Test Endpoints

All endpoints are under `/v1/payments/test/*` and **bypass authentication**:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v1/payments/test/config` | GET | Get all configuration values |
| `/v1/payments/test/calculate/coins` | POST | Calculate coins for INR |
| `/v1/payments/test/calculate/inr` | POST | Calculate INR for coins |
| `/v1/payments/test/calculate/diamonds` | POST | Convert coins to diamonds |
| `/v1/payments/test/calculate/diamond-inr` | POST | Calculate INR for diamonds |
| `/v1/payments/test/calculate/upsell` | POST | Calculate upsell redemption value |
| `/v1/payments/test/redemption/preview` | POST | Preview redemption with upsell (no wallet service needed) |

## Running Tests

### Quick Start

```bash
# Terminal 1: Start service in test mode
cd tests/payment-service
./start-local-server.sh

# Terminal 2: Run tests
cd tests/payment-service
./test-payment-e2e.sh
```

### Test Mode

The service can run in **TEST MODE** by setting:
```bash
export ALLOW_TEST_MODE=true
```

**Test Mode Features:**
- ✅ No Razorpay keys required (uses dummy values)
- ✅ Database connection optional
- ✅ JWT keys optional
- ✅ Encryption key auto-generated if missing
- ✅ Test endpoints work without external dependencies

## What Gets Tested

### ✅ Tested (Without Keys)
- All calculation formulas
- Upsell logic and multipliers
- Validation rules
- Configuration retrieval
- Error handling
- Health checks

### ❌ Not Tested (Requires Keys)
- Actual Razorpay order creation
- Payment verification
- Payout creation
- Webhook processing
- Wallet service integration
- Database operations (with real data)

## Expected Results

All 17 tests should pass when:
- Service is running
- Test mode is enabled (`ALLOW_TEST_MODE=true`)
- PostgreSQL is running (for health check)

## Troubleshooting

### Service won't start
- Check if `ALLOW_TEST_MODE=true` is set
- Verify DATABASE_URL is set (can be dummy for test mode)
- Check logs for configuration errors

### Tests failing
- Verify service is running on port 3008
- Check service logs for errors
- Ensure `jq` is installed: `brew install jq` (macOS) or `apt-get install jq` (Linux)

### Health check failing
- In test mode, health check may show "healthy_test_mode" if DB not connected
- This is expected and tests will still pass
