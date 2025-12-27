# Complete Testing Guide - Step by Step

## ✅ Prerequisites Checklist

### 1. System Requirements
- [x] **Node.js v22+** installed
- [x] **PostgreSQL** running and accessible
- [x] **Redis** running (for metrics)
- [x] **curl** installed (usually pre-installed on Mac/Linux)
- [x] **jq** installed (for JSON parsing in test script)

### 2. Database Setup

#### Check PostgreSQL is running:
```bash
# Mac (Homebrew)
brew services list | grep postgresql

# Or check if it's running
psql -l 2>/dev/null && echo "PostgreSQL is running" || echo "PostgreSQL is NOT running"
```

#### Create database (if needed):
```bash
# Connect to PostgreSQL
psql postgres

# Create database
CREATE DATABASE hmm_auth;

# Exit
\q
```

### 3. Redis Setup

#### Check Redis is running:
```bash
# Mac (Homebrew)
brew services list | grep redis

# Or test connection
redis-cli ping
# Should return: PONG
```

#### Start Redis (if not running):
```bash
# Mac (Homebrew)
brew services start redis

# Or run directly
redis-server
```

### 4. Environment Variables

Create `.env` file in `apps/auth-service/`:

```bash
cd apps/auth-service
touch .env
```

**Minimum required for basic testing:**
```bash
# Server
PORT=3001
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173

# Database (REQUIRED)
DATABASE_URL="postgresql://postgres:password@localhost:5432/hmm_auth?schema=public"
# Replace: postgres:password with your PostgreSQL username:password

# JWT (REQUIRED - generate these)
JWT_PUBLIC_JWK='{"kty":"EC","crv":"P-256","x":"...","y":"..."}'
JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"

# Redis (REQUIRED for metrics)
REDIS_URL="redis://localhost:6379"

# OAuth (OPTIONAL - only needed for OAuth testing)
GOOGLE_CLIENT_ID="your-google-client-id"
APPLE_AUD="your-apple-bundle-id"

# Twilio (OPTIONAL - only needed for phone OTP testing)
TWILIO_ACCOUNT_SID="your-twilio-account-sid"
TWILIO_AUTH_TOKEN="your-twilio-auth-token"
TWILIO_VERIFY_SID="your-twilio-verify-service-sid"
```

**Quick JWT Key Generation (if you don't have them):**
```bash
# Generate EC key pair for JWT
openssl ecparam -genkey -name prime256v1 -noout -out private-key.pem
openssl ec -in private-key.pem -pubout -out public-key.pem

# Convert to JWK format (you'll need to do this manually or use a tool)
# Or use an online tool: https://mkjwk.org/
```

### 5. Install Dependencies

```bash
cd apps/auth-service
npm install
# or if using pnpm from root
cd ../..
pnpm install
```

### 6. Database Migration

```bash
cd apps/auth-service

# Generate Prisma client
npm run prisma:generate

# Sync schema to database
npm run prisma:push
```

This creates all tables: `User`, `Preference`, `Session`, `MeetingCounter`

---

## 🚀 Running the Tests

### Step 1: Start the Auth Service

**Terminal 1:**
```bash
cd apps/auth-service
npm run start:dev
```

Wait for: `🚀 Auth service running on http://localhost:3001`

### Step 2: Run the Test Script

**Terminal 2:**
```bash
cd apps/auth-service

# Make script executable (first time only)
chmod +x test-auth.sh

# Run the test script
./test-auth.sh
```

**Or run directly:**
```bash
bash test-auth.sh
```

### Step 3: Expected Output

You should see:
```
🧪 Testing Auth Service
Base URL: http://localhost:3001

1. Checking if service is running...
✅ Service is running

2. Testing metrics endpoint...
✅ Metrics endpoint working
{
  "liveMeetings": 0
}

3. Testing phone OTP send endpoint...
⚠️  Phone OTP endpoint response (may need Twilio config):
{"ok":true}  # or error if Twilio not configured

4. Testing validation (should fail without acceptedTerms)...
✅ Validation is working
{
  "issues": [...],
  "name": "ZodError"
}

5. Testing unauthorized access to /me...
✅ Authorization check is working (401 as expected)

✅ Basic endpoint tests complete!
```

---

## 🧪 Manual Testing (After Script Passes)

### Test 1: Get Metrics (No Auth Required)
```bash
curl http://localhost:3001/me/metrics
```

**Expected:** `{"liveMeetings": 0}`

### Test 2: Test Validation (Should Fail)
```bash
curl -X POST http://localhost:3001/auth/google \
  -H "Content-Type: application/json" \
  -d '{"idToken": "test"}'
```

**Expected:** Error about `acceptedTerms` being required

### Test 3: Test Unauthorized Access
```bash
curl http://localhost:3001/me
```

**Expected:** `401 Unauthorized` or error message

---

## 🔧 Troubleshooting

### Service won't start
```bash
# Check if port 3001 is in use
lsof -i :3001

# Kill process if needed
kill -9 <PID>

# Check environment variables
cd apps/auth-service
cat .env
```

### Database connection error
```bash
# Test PostgreSQL connection
psql "postgresql://postgres:password@localhost:5432/hmm_auth"

# Check DATABASE_URL in .env matches your setup
```

### Redis connection error
```bash
# Test Redis connection
redis-cli ping

# Should return: PONG
```

### Prisma errors
```bash
cd apps/auth-service
npm run prisma:generate
npm run prisma:push
```

### Script says "Service is not running"
1. Check service is actually running: `curl http://localhost:3001/me/metrics`
2. Check the port in `.env` matches (default: 3001)
3. Check for errors in Terminal 1 where service is running

---

## 📋 Full Test Checklist

### Basic Tests (No OAuth needed)
- [ ] Service starts without errors
- [ ] Metrics endpoint returns data
- [ ] Validation rejects invalid requests
- [ ] Unauthorized access returns 401
- [ ] Phone OTP endpoint is accessible (may fail without Twilio)

### OAuth Tests (Need real tokens)
- [ ] Google signup/login
- [ ] Facebook signup/login
- [ ] Apple signup/login
- [ ] Phone OTP send/verify

### User Flow Tests (Need access token)
- [ ] Get user info (`/me`)
- [ ] Update preferences
- [ ] Refresh token
- [ ] Logout

---

## 🎯 Quick Start (TL;DR)

```bash
# 1. Start PostgreSQL and Redis
brew services start postgresql
brew services start redis

# 2. Setup environment
cd apps/auth-service
# Create .env file with DATABASE_URL, JWT keys, REDIS_URL

# 3. Setup database
npm run prisma:generate
npm run prisma:push

# 4. Start service (Terminal 1)
npm run start:dev

# 5. Run tests (Terminal 2)
chmod +x test-auth.sh
./test-auth.sh
```

---

## 📚 Next Steps

After basic tests pass:
1. See `TESTING.md` for detailed OAuth flow testing
2. See `QUICK_TEST.md` for quick reference commands
3. Test with real OAuth tokens from your frontend
4. Test full user flows end-to-end

