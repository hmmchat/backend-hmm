# Discovery Service Tests

## Overview

This directory contains comprehensive tests for the discovery-service, including:
- Metrics endpoint tests
- Gender filter endpoint tests

## Prerequisites

1. **Services Running:**
   - `user-service` on port 3002
   - `wallet-service` on port 3005
   - `discovery-service` on port 3004 (will auto-start if not running)

2. **Database Setup:**
   ```bash
   cd apps/discovery-service
   npm run prisma:deploy  # Apply migrations
   npm run prisma:seed    # Seed test data
   ```

3. **Test Tokens:**
   Create a `.test-tokens` file in this directory with tokens for different user genders:
   ```bash
   # tests/discovery-service/.test-tokens
   export TOKEN_MALE="eyJ..."
   export TOKEN_FEMALE="eyJ..."
   export TOKEN_NON_BINARY="eyJ..."
   export TOKEN_PREFER_NOT_TO_SAY="eyJ..."
   ```

## Getting Test Tokens

### Option 1: Create Users One at a Time (Recommended)

Create users individually and test one gender at a time:

```bash
cd tests/discovery-service

# Create a user (example: PREFER_NOT_TO_SAY)
./create-single-user.sh PREFER_NOT_TO_SAY +918073656316

# Run tests
./test-discovery-service.sh

# After testing, delete the user and create the next gender
# (Delete user manually from database or use a deletion script)
./create-single-user.sh MALE +918073656316
./test-discovery-service.sh
```

**Benefits:**
- Works with Twilio free tier rate limits
- Creates users one at a time
- Automatically saves tokens to `.test-tokens`
- Tests run only for available tokens
- Simple workflow: create → test → delete → repeat

### Option 2: Use Existing Users

If you already have test users with different genders, manually add tokens to `.test-tokens`:

```bash
# Edit .test-tokens file
export TOKEN_MALE="your_male_user_token"
export TOKEN_FEMALE="your_female_user_token"
export TOKEN_NON_BINARY="your_non_binary_user_token"
export TOKEN_PREFER_NOT_TO_SAY="your_prefer_not_to_say_user_token"
```

## Running Tests

```bash
cd tests/discovery-service
./test-discovery-service.sh
```

## Test Coverage

### Phase 1: Metrics Endpoint
- ✅ Get active meetings count
- ✅ Service integration verification
- ✅ Response format validation

### Phase 2: Gender Filter Endpoint
- ✅ Get gender filters without token (401)
- ✅ Get gender filters with invalid token (401)
- ✅ Get gender filters for PREFER_NOT_TO_SAY user (disabled)
- ✅ Get gender filters for MALE user (2 options)
- ✅ Get gender filters for FEMALE user (2 options)
- ✅ Get gender filters for NON_BINARY user (3 options)
- ✅ Apply gender filter (purchase)
- ✅ Apply gender filter with invalid selection (400)
- ✅ Apply gender filter without token (401)

## Expected Test Results

All tests should pass when:
- All services are running
- Database is migrated and seeded
- Test tokens are configured

## Troubleshooting

### Tests Failing
1. Check all services are running
2. Verify database migrations are applied
3. Ensure test tokens are valid and users exist
4. Check service logs for errors

### Missing Test Tokens
Some tests will be skipped if tokens are not provided. This is expected behavior.

### Twilio Rate Limits (Free Tier)
If you get "Internal server error" when sending OTP:
- Twilio free tier allows ~1 OTP per minute
- Use `create-single-user.sh` to create users one at a time
- Wait a few minutes between OTP requests

### Profile Creation Failed
If profile creation fails:
- Check moderation service is running (if using real moderation)
- Placeholder images may fail moderation - this is expected in testing
- Re-run `create-single-user.sh` to ensure profile is created correctly
- Check user-service logs for errors
