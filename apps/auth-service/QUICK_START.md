# Quick Start Guide - Running Tests

## 📋 Current Status Check

✅ **Ready:**
- Test script is executable
- `jq` is installed (for JSON parsing)
- PostgreSQL is running and accessible
- Database `hmm_auth` exists
- `.env` file exists

❌ **Needs Setup:**
- Redis is NOT running (required for metrics endpoint)
- Auth service is NOT running (needs to be started)

---

## 🚀 Step-by-Step Setup

### Step 1: Start Redis

Redis is required for the metrics endpoint. Start it:

```bash
# Option 1: Using Homebrew services (recommended)
brew services start redis

# Option 2: Run directly in a terminal
redis-server
```

**Verify Redis is running:**
```bash
redis-cli ping
# Should return: PONG
```

### Step 2: Setup Database (Prisma)

Make sure your database schema is synced:

```bash
cd apps/auth-service

# Generate Prisma client
npm run prisma:generate

# Sync schema to database (for development)
npm run prisma:push
```

### Step 3: Start the Auth Service

In a terminal, start the service:

```bash
cd apps/auth-service
npm run start:dev
```

**Verify service is running:**
```bash
curl http://localhost:3001/me/metrics
# Should return JSON with liveMeetings count
```

---

## 🧪 Running the Test Script

Once Redis and the auth service are running:

```bash
cd apps/auth-service
./test-auth.sh
```

Or with a custom base URL:
```bash
BASE_URL=http://localhost:3001 ./test-auth.sh
```

---

## 📝 What the Test Script Does

The `test-auth.sh` script performs **5 basic endpoint tests**:

1. **Service Health Check** - Verifies the service is running
   - Tests: `GET /me/metrics`
   - Expects: Service to respond

2. **Metrics Endpoint** - Tests the metrics endpoint
   - Tests: `GET /me/metrics`
   - Expects: Valid JSON response with `liveMeetings` count

3. **Phone OTP Send** - Tests phone OTP endpoint (may fail without Twilio)
   - Tests: `POST /auth/phone/send-otp`
   - Expects: Endpoint accessible (may error without Twilio config)

4. **Validation Test** - Tests request validation
   - Tests: `POST /auth/google` without `acceptedTerms`
   - Expects: Validation error (should fail as expected)

5. **Authorization Check** - Tests protected endpoint
   - Tests: `GET /me` without authorization
   - Expects: 401 Unauthorized

---

## 🔍 What Each Test Validates

### ✅ Test 1: Service Health
- **Purpose**: Ensures the service is running and accessible
- **Endpoint**: `/me/metrics`
- **Success**: Service responds (doesn't need auth)

### ✅ Test 2: Metrics Endpoint
- **Purpose**: Validates metrics endpoint returns proper JSON
- **Endpoint**: `/me/metrics`
- **Success**: Returns JSON like `{"liveMeetings": 140567}`
- **Requires**: Redis running

### ⚠️ Test 3: Phone OTP Send
- **Purpose**: Checks if phone OTP endpoint is accessible
- **Endpoint**: `/auth/phone/send-otp`
- **Success**: Endpoint responds (may fail without Twilio credentials)
- **Note**: This is expected to fail if Twilio isn't configured

### ✅ Test 4: Validation
- **Purpose**: Ensures validation middleware works
- **Endpoint**: `/auth/google`
- **Success**: Returns validation error about missing `acceptedTerms`
- **Note**: This test expects a validation error (that's the success case!)

### ✅ Test 5: Authorization
- **Purpose**: Verifies protected routes require authentication
- **Endpoint**: `/me`
- **Success**: Returns 401 Unauthorized
- **Note**: This test expects 401 (that's the success case!)

---

## 🎯 Next Steps After Basic Tests

Once the basic tests pass, you can test full authentication flows:

1. **OAuth Flows** (need real tokens):
   - Google signup/login
   - Facebook signup/login
   - Apple signup/login

2. **Phone OTP Flow** (need Twilio):
   - Send OTP
   - Verify OTP and login

3. **User Flows** (need access token):
   - Get user info (`/me`)
   - Update preferences
   - Refresh token
   - Logout

See `TESTING.md` for detailed instructions on testing these flows.

---

## 🐛 Troubleshooting

### Script says "Service is not running"
1. Check if service is actually running: `curl http://localhost:3001/me/metrics`
2. Check the port in `.env` matches (default: 3001)
3. Check for errors in the terminal where you started the service

### Redis connection errors
- Ensure Redis is running: `redis-cli ping`
- Check `REDIS_URL` in `.env` matches your Redis setup

### Database errors
- Run `npm run prisma:generate` and `npm run prisma:push`
- Check `DATABASE_URL` in `.env` is correct
- Ensure PostgreSQL is running

### Metrics endpoint returns error
- Redis must be running
- Check Redis connection: `redis-cli ping`

---

## 📚 Full Documentation

- **`TESTING.md`** - Complete testing guide with all flows
- **`HOW_TO_TEST.md`** - Alternative testing guide
- **`README.md`** - Service documentation

