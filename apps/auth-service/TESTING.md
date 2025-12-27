# Testing Guide - Auth Service

This guide helps you test all authentication flows before pushing to production.

## Prerequisites

### 1. Environment Variables Setup

Create a `.env` file in `apps/auth-service/` with the following variables:

```bash
# Server
PORT=3001
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173

# Database
DATABASE_URL="postgresql://user:password@localhost:5432/auth_db?schema=public"

# JWT
JWT_PUBLIC_JWK='{"kty":"EC","crv":"P-256","x":"...","y":"..."}'
JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"

# OAuth Providers
GOOGLE_CLIENT_ID="your-google-client-id"
APPLE_AUD="your-apple-bundle-id"
# Facebook doesn't need env var (uses access token directly)

# Twilio (for phone OTP)
TWILIO_ACCOUNT_SID="your-twilio-account-sid"
TWILIO_AUTH_TOKEN="your-twilio-auth-token"
TWILIO_VERIFY_SID="your-twilio-verify-service-sid"

# Redis (for metrics)
REDIS_URL="redis://localhost:6379"
```

### 2. Database Setup

```bash
# Navigate to auth-service
cd apps/auth-service

# Generate Prisma client (Prisma 6.0.0)
npm run prisma:generate

# Sync schema to database (recommended for development)
npm run prisma:push

# OR create a migration (interactive - run manually in terminal)
npm run prisma:migrate -- --name your_migration_name

# This will:
# - Create the database tables (User, Preference, Session, MeetingCounter)
# - Generate Prisma client with TypeScript types
# 
# Note: `prisma:push` syncs schema directly (no migration files)
#       `prisma:migrate` creates migration files (better for production)
```

### 3. Start Services

```bash
# Terminal 1: Start PostgreSQL (if not running)
# brew services start postgresql@14  # or your version

# Terminal 2: Start Redis (if not running)
# brew services start redis
# OR
# redis-server

# Terminal 3: Start auth service
cd apps/auth-service
npm run start:dev
```

The service should start on `http://localhost:3001`

## Testing All Flows

### Base URL
```
http://localhost:3001
```

---

## Flow 1: Google Signup/Login

### Step 1: Get Google ID Token
You need a valid Google ID token. You can:
- Use Google OAuth Playground: https://developers.google.com/oauthplayground/
- Or get it from your frontend after Google Sign-In

### Step 2: Signup/Login with Google

```bash
curl -X POST http://localhost:3001/auth/google \
  -H "Content-Type: application/json" \
  -d '{
    "idToken": "YOUR_GOOGLE_ID_TOKEN",
    "acceptedTerms": true,
    "acceptedTermsVer": "v1.0"
  }'
```

**Expected Response:**
```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ..."
}
```

**Test Cases:**
- ✅ With `acceptedTerms: true` → Should succeed
- ❌ With `acceptedTerms: false` → Should fail with validation error
- ❌ With invalid `idToken` → Should fail with 401

---

## Flow 2: Facebook Signup/Login

### Step 1: Get Facebook Access Token
Get it from Facebook Login flow in your frontend or use Facebook Graph API Explorer.

### Step 2: Signup/Login with Facebook

```bash
curl -X POST http://localhost:3001/auth/facebook \
  -H "Content-Type: application/json" \
  -d '{
    "accessToken": "YOUR_FACEBOOK_ACCESS_TOKEN",
    "acceptedTerms": true,
    "acceptedTermsVer": "v1.0"
  }'
```

**Expected Response:**
```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ..."
}
```

**Test Cases:**
- ✅ Valid access token → Should succeed
- ❌ Invalid/expired token → Should fail with 401
- ❌ Missing `acceptedTerms` → Should fail with validation error

---

## Flow 3: Apple Signup/Login

### Step 1: Get Apple Identity Token
Get it from Apple Sign-In flow in your frontend.

### Step 2: Signup/Login with Apple

```bash
curl -X POST http://localhost:3001/auth/apple \
  -H "Content-Type: application/json" \
  -d '{
    "identityToken": "YOUR_APPLE_IDENTITY_TOKEN",
    "acceptedTerms": true,
    "acceptedTermsVer": "v1.0"
  }'
```

**Expected Response:**
```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ..."
}
```

**Test Cases:**
- ✅ Valid identity token → Should succeed
- ❌ Invalid token → Should fail with error

---

## Flow 4: Phone OTP Signup/Login

### Step 1: Send OTP

```bash
curl -X POST http://localhost:3001/auth/phone/send-otp \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "1234567890"
  }'
```

**Expected Response:**
```json
{
  "ok": true
}
```

**Note:** This sends an SMS via Twilio. Check your Twilio logs or phone for the OTP code.

### Step 2: Verify OTP and Signup/Login

```bash
curl -X POST http://localhost:3001/auth/phone/verify \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "1234567890",
    "code": "123456",
    "acceptedTerms": true,
    "acceptedTermsVer": "v1.0"
  }'
```

**Expected Response:**
```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ..."
}
```

**Test Cases:**
- ✅ Valid OTP → Should succeed
- ❌ Invalid/expired OTP → Should fail
- ❌ Wrong phone number → Should fail

---

## Flow 5: Get User Info (Me)

After getting `accessToken` from any signup/login flow:

```bash
curl -X GET http://localhost:3001/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Expected Response:**
```json
{
  "user": {
    "id": "clx...",
    "email": "user@example.com",
    "name": "John Doe",
    "photoUrl": "https://...",
    "acceptedTerms": true,
    "acceptedTermsAt": "2024-01-01T00:00:00.000Z",
    "preferences": {
      "userId": "clx...",
      "videoEnabled": true,
      "meetMode": "both",
      "latitude": null,
      "longitude": null
    }
  }
}
```

**Test Cases:**
- ✅ Valid token → Should return user info
- ❌ Missing token → Should fail with 401
- ❌ Invalid/expired token → Should fail with 401

---

## Flow 6: Update Preferences

```bash
curl -X PATCH http://localhost:3001/me/preferences \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "videoEnabled": false,
    "meetMode": "location",
    "location": {
      "lat": 37.7749,
      "lng": -122.4194
    }
  }'
```

**Expected Response:**
```json
{
  "preferences": {
    "userId": "clx...",
    "videoEnabled": false,
    "meetMode": "location",
    "latitude": 37.7749,
    "longitude": -122.4194
  }
}
```

**Test Cases:**
- ✅ Update with location → Should save preferences
- ✅ Update without location → Should work
- ✅ Change `meetMode` to "both" or "location" → Should work
- ❌ Invalid token → Should fail with 401

---

## Flow 7: Get Live Meetings Count

```bash
curl -X GET http://localhost:3001/me/metrics
```

**Expected Response:**
```json
{
  "liveMeetings": 140567
}
```

**Note:** This reads from Redis. Make sure Redis is running and the counter is being updated.

---

## Flow 8: Refresh Access Token

```bash
curl -X POST http://localhost:3001/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "YOUR_REFRESH_TOKEN"
  }'
```

**Expected Response:**
```json
{
  "accessToken": "eyJ..."
}
```

**Test Cases:**
- ✅ Valid refresh token → Should return new access token
- ❌ Invalid/expired refresh token → Should fail with 401
- ❌ Already used refresh token → Should fail

---

## Flow 9: Logout

```bash
curl -X POST http://localhost:3001/auth/logout \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "YOUR_REFRESH_TOKEN"
  }'
```

**Expected Response:**
```json
{
  "ok": true
}
```

**Test Cases:**
- ✅ Valid refresh token → Should delete session
- ✅ After logout, refresh should fail → Verify session is deleted

---

## Complete Test Checklist

### Pre-flight Checks
- [ ] Database is running and accessible
- [ ] Redis is running (for metrics)
- [ ] All environment variables are set
- [ ] Prisma migrations are applied
- [ ] Service starts without errors

### Authentication Flows
- [ ] Google signup (new user)
- [ ] Google login (existing user)
- [ ] Facebook signup
- [ ] Facebook login
- [ ] Apple signup
- [ ] Apple login
- [ ] Phone OTP send
- [ ] Phone OTP verify (signup)
- [ ] Phone OTP verify (login existing)

### User Flows
- [ ] Get user info (me endpoint)
- [ ] Update preferences (with location)
- [ ] Update preferences (without location)
- [ ] Get live meetings count

### Token Management
- [ ] Refresh access token
- [ ] Logout
- [ ] Verify refresh fails after logout

### Error Cases
- [ ] Signup without accepting terms → Should fail
- [ ] Invalid OAuth tokens → Should fail
- [ ] Invalid OTP → Should fail
- [ ] Missing authorization header → Should fail
- [ ] Expired access token → Should fail

---

## Quick Test Script

Save this as `test-auth.sh`:

```bash
#!/bin/bash

BASE_URL="http://localhost:3001"

echo "🧪 Testing Auth Service..."
echo ""

# Test 1: Health check (if you add it)
echo "1. Testing metrics endpoint..."
curl -s "$BASE_URL/me/metrics" | jq .
echo ""

# Test 2: Phone OTP send
echo "2. Sending OTP..."
curl -s -X POST "$BASE_URL/auth/phone/send-otp" \
  -H "Content-Type: application/json" \
  -d '{"phone": "1234567890"}' | jq .
echo ""

echo "✅ Basic endpoints are working!"
echo "⚠️  For OAuth flows, you need real tokens from providers"
```

Make it executable:
```bash
chmod +x test-auth.sh
./test-auth.sh
```

---

## Using Postman/Insomnia

1. **Import Collection**: Create a new collection with all endpoints
2. **Set Base URL**: `http://localhost:3001`
3. **Environment Variables**:
   - `baseUrl`: `http://localhost:3001`
   - `accessToken`: (set after login)
   - `refreshToken`: (set after login)

4. **Test Sequence**:
   - Signup with Google/Facebook/Apple/Phone
   - Save tokens to environment
   - Test `/me` endpoint
   - Update preferences
   - Test refresh token
   - Test logout

---

## Troubleshooting

### Service won't start
- Check if port 3001 is available
- Verify all environment variables are set
- Check database connection

### Database errors
- Run `npm run prisma:generate` (regenerates Prisma client)
- Run `npm run prisma:push` (syncs schema for development)
- OR run `npm run prisma:migrate` (creates migration files)
- Check `DATABASE_URL` is correct in `.env` file
- Ensure PostgreSQL is running and accessible

### OAuth errors
- Verify client IDs are correct
- Check token format
- Ensure tokens are not expired

### Redis errors
- Ensure Redis is running
- Check `REDIS_URL` is correct

---

## Next Steps After Testing

1. ✅ All flows work as expected
2. ✅ Error cases are handled properly
3. ✅ Database schema is correct
4. ✅ Environment variables are documented
5. ✅ Ready to push! 🚀

