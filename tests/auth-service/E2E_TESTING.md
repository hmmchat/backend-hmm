# End-to-End Testing Guide

Complete guide for testing all authentication flows end-to-end.

---

## ✅ Prerequisites Checklist

Before running `./test-e2e.sh`, ensure you have:

### 1. **Service Running**
- ✅ Auth service is running on `http://localhost:3001`
- ✅ Start with: `cd apps/auth-service && npm run start:dev`

### 2. **Database Setup**
- ✅ PostgreSQL is running
- ✅ Database created and Prisma schema synced:
  ```bash
  cd apps/auth-service
  npm run prisma:generate
  npm run prisma:push
  ```

### 3. **Redis Running** (for metrics)
- ✅ Redis is running: `redis-cli ping` should return `PONG`
- ✅ Start with: `brew services start redis` (Mac) or `redis-server`

### 4. **Environment Variables** (in `apps/auth-service/.env`)
- ✅ `DATABASE_URL` - PostgreSQL connection string
- ✅ `JWT_PUBLIC_JWK` - JWT public key (JSON format)
- ✅ `JWT_PRIVATE_KEY` - JWT private key
- ✅ `REDIS_URL` - Redis connection string (default: `redis://localhost:6379`)
- ✅ `PORT` - Service port (default: 3001)

### 5. **OAuth Provider Setup** (At least one required to get tokens)

**Minimum Required:** You only need ONE method to get tokens and run `test-e2e.sh`. Choose the easiest:

#### Option A: Google OAuth (Easiest - Recommended)
- ✅ `GOOGLE_CLIENT_ID` in `.env`
  - Easiest: Use OAuth Playground default: `407408718192.apps.googleusercontent.com`
  - No Google Cloud setup needed
  - **Recommended for first-time testing**

#### Option B: Facebook OAuth (Easy)
- ✅ Facebook account (for Graph API Explorer)
- ✅ No app setup needed - use Graph API Explorer default app
- ✅ No environment variables needed

#### Option C: Phone OTP (Moderate)
- ✅ Twilio account (free trial: https://www.twilio.com/try-twilio)
- ✅ `TWILIO_ACCOUNT_SID` in `.env` - From Twilio Console dashboard
- ✅ `TWILIO_AUTH_TOKEN` in `.env` - From Twilio Console (click "View" to reveal)
- ✅ `TWILIO_VERIFY_SID` in `.env` - Create Verify Service in Twilio Console

#### Option D: Apple Sign-In (Advanced)
- ✅ Apple Developer account (free or paid)
- ✅ App configured in Apple Developer Portal with Sign In with Apple enabled
- ✅ `APPLE_AUD` in `.env` - Your Apple Bundle ID or Service ID

**Note:** You don't need all of them! Start with Google OAuth (Option A) - it's the easiest.

### 6. **System Tools**
- ✅ `curl` - Usually pre-installed
- ✅ `jq` - JSON parser (install: `brew install jq` on Mac)

### 7. **Tokens** (Required to run tests)
- ✅ Access Token and Refresh Token from any authentication method
- ✅ Get tokens by running: `./test-full-flow.sh` (Google OAuth)
- ✅ Or follow instructions in: `HOW_TO_GET_TOKENS.md`

---

## 🚀 Quick Start

Once all prerequisites are met:

```bash
cd apps/auth-service
./test-e2e.sh
```

The script will ask for your access and refresh tokens if not provided.

---

## 📋 What Gets Tested

The `test-e2e.sh` script tests:
1. ✅ Get user info (`GET /me`)
2. ✅ Update preferences with location (`PATCH /me/preferences`)
3. ✅ Update preferences without location (`PATCH /me/preferences`)
4. ✅ Refresh access token (`POST /auth/refresh`)
5. ✅ Verify new access token works (`GET /me`)
6. ✅ Logout (`POST /auth/logout`)
7. ✅ Verify refresh token is invalidated (`POST /auth/refresh`)

---

Now that basic tests pass, here's how to test complete authentication flows.

## 🎯 Testing Strategy

### What You Can Test NOW (Without External Services)

1. ✅ **Token Management Flows** - Once you have tokens
   - Get user info (`/me`)
   - Update preferences
   - Refresh token
   - Logout

2. ✅ **Validation & Error Handling** - Already tested
   - Missing `acceptedTerms`
   - Invalid tokens
   - Missing authorization

### What Requires External Services

1. 🔑 **OAuth Flows** - Need real tokens from providers
   - Google Sign-In
   - Facebook Login
   - Apple Sign-In

2. 📱 **Phone OTP** - Needs Twilio credentials
   - Send OTP
   - Verify OTP

---

## 🚀 Quick Start: Test Token-Based Flows

### Option 1: Use the Interactive Test Script (Easiest)

**Recommended for first-time testing:**

```bash
cd apps/auth-service
./test-e2e.sh
```

The script will guide you through everything interactively. If you don't have tokens yet, run `./test-full-flow.sh` first to get tokens from Google OAuth.

---

### Option 2: Use a Test Token (If you have one)

If you already have an `accessToken` from a previous test:

```bash
# Set your token
export ACCESS_TOKEN="your_access_token_here"
export REFRESH_TOKEN="your_refresh_token_here"

# Test get user info
curl -X GET http://localhost:3001/me \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq .

# Test update preferences
curl -X PATCH http://localhost:3001/me/preferences \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "videoEnabled": false,
    "meetMode": "location",
    "location": {"lat": 37.7749, "lng": -122.4194}
  }' | jq .

# Test refresh token
curl -X POST http://localhost:3001/auth/refresh \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\": \"$REFRESH_TOKEN\"}" | jq .

# Test logout
curl -X POST http://localhost:3001/auth/logout \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\": \"$REFRESH_TOKEN\"}" | jq .
```

### Option 2: Get Real OAuth Tokens

To test the full flow, you need real OAuth tokens. Here's how:

---

## 🔑 Getting OAuth Tokens for Testing

### Google OAuth Token

**Method 1: Google OAuth Playground** (Easiest for testing)

1. Go to https://developers.google.com/oauthplayground/
2. Click the gear icon (⚙️) in top right
3. Check "Use your own OAuth credentials"
4. Enter your `GOOGLE_CLIENT_ID` from `.env`
5. In the left panel, find "Google OAuth2 API v2"
6. Select scope: `https://www.googleapis.com/auth/userinfo.email`
7. Click "Authorize APIs"
8. After authorization, click "Exchange authorization code for tokens"
9. Copy the `id_token` from the response

**Method 2: From Frontend**

If you have a frontend with Google Sign-In:
1. Sign in with Google
2. Get the ID token from the response
3. Use that token in your API calls

**Test with the token:**

```bash
# Replace YOUR_GOOGLE_ID_TOKEN with the token from above
curl -X POST http://localhost:3001/auth/google \
  -H "Content-Type: application/json" \
  -d '{
    "idToken": "YOUR_GOOGLE_ID_TOKEN",
    "acceptedTerms": true,
    "acceptedTermsVer": "v1.0"
  }' | jq .

# Save the tokens
export ACCESS_TOKEN=$(curl -s -X POST http://localhost:3001/auth/google \
  -H "Content-Type: application/json" \
  -d '{
    "idToken": "YOUR_GOOGLE_ID_TOKEN",
    "acceptedTerms": true,
    "acceptedTermsVer": "v1.0"
  }' | jq -r '.accessToken')

export REFRESH_TOKEN=$(curl -s -X POST http://localhost:3001/auth/google \
  -H "Content-Type: application/json" \
  -d '{
    "idToken": "YOUR_GOOGLE_ID_TOKEN",
    "acceptedTerms": true,
    "acceptedTermsVer": "v1.0"
  }' | jq -r '.refreshToken')

echo "Access Token: $ACCESS_TOKEN"
echo "Refresh Token: $REFRESH_TOKEN"
```

### Facebook Access Token

**Method 1: Facebook Graph API Explorer**

1. Go to https://developers.facebook.com/tools/explorer/
2. Select your app
3. Get User Token with permissions: `email`, `public_profile`
4. Copy the access token

**Test with the token:**

```bash
curl -X POST http://localhost:3001/auth/facebook \
  -H "Content-Type: application/json" \
  -d '{
    "accessToken": "YOUR_FACEBOOK_ACCESS_TOKEN",
    "acceptedTerms": true,
    "acceptedTermsVer": "v1.0"
  }' | jq .
```

### Apple Identity Token

Apple Sign-In requires a real iOS/macOS app or web implementation. The token comes from Apple's Sign-In flow.

**Test with the token:**

```bash
curl -X POST http://localhost:3001/auth/apple \
  -H "Content-Type: application/json" \
  -d '{
    "identityToken": "YOUR_APPLE_IDENTITY_TOKEN",
    "acceptedTerms": true,
    "acceptedTermsVer": "v1.0"
  }' | jq .
```

---

## 📱 Testing Phone OTP Flow

### Prerequisites

1. Twilio account with Verify service
2. Set in `.env`:
   ```
   TWILIO_ACCOUNT_SID="your-account-sid"
   TWILIO_AUTH_TOKEN="your-auth-token"
   TWILIO_VERIFY_SID="your-verify-service-sid"
   ```

### Test Flow

```bash
# Step 1: Send OTP
curl -X POST http://localhost:3001/auth/phone/send-otp \
  -H "Content-Type: application/json" \
  -d '{"phone": "+918073656316"}' | jq .

# Step 2: Check your phone/SMS for the OTP code

# Step 3: Verify OTP and login
curl -X POST http://localhost:3001/auth/phone/verify \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+918073656316",
    "code": "123456",
    "acceptedTerms": true,
    "acceptedTermsVer": "v1.0"
  }' | jq .
```

---

## 🧪 Complete End-to-End Test Flow

Here's a complete flow to test everything:

### 1. Sign Up/Login (Get Tokens)

```bash
# Use one of the OAuth methods above to get tokens
# Or use phone OTP if Twilio is configured

# Save tokens
export ACCESS_TOKEN="your_access_token"
export REFRESH_TOKEN="your_refresh_token"
```

### 2. Get User Info

```bash
curl -X GET http://localhost:3001/me \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq .
```

**Expected:** User object with email, name, preferences, etc.

### 3. Update Preferences (With Location)

```bash
curl -X PATCH http://localhost:3001/me/preferences \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "videoEnabled": false,
    "meetMode": "location",
    "location": {
      "lat": 37.7749,
      "lng": -122.4194
    }
  }' | jq .
```

**Expected:** Updated preferences with location

### 4. Update Preferences (Without Location)

```bash
curl -X PATCH http://localhost:3001/me/preferences \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "videoEnabled": true,
    "meetMode": "both"
  }' | jq .
```

**Expected:** Updated preferences without location

### 5. Refresh Access Token

```bash
curl -X POST http://localhost:3001/auth/refresh \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\": \"$REFRESH_TOKEN\"}" | jq .

# Save new access token
export NEW_ACCESS_TOKEN=$(curl -s -X POST http://localhost:3001/auth/refresh \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\": \"$REFRESH_TOKEN\"}" | jq -r '.accessToken')
```

**Expected:** New access token

### 6. Verify New Token Works

```bash
curl -X GET http://localhost:3001/me \
  -H "Authorization: Bearer $NEW_ACCESS_TOKEN" | jq .
```

**Expected:** User info (same as step 2)

### 7. Logout

```bash
curl -X POST http://localhost:3001/auth/logout \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\": \"$REFRESH_TOKEN\"}" | jq .
```

**Expected:** `{"ok": true}`

### 8. Verify Refresh Token No Longer Works

```bash
curl -X POST http://localhost:3001/auth/refresh \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\": \"$REFRESH_TOKEN\"}" | jq .
```

**Expected:** 401 Unauthorized (token was invalidated)

---

## 📋 Test Checklist

### ✅ Basic Tests (Already Passed)
- [x] Service health check
- [x] Metrics endpoint
- [x] Validation errors
- [x] Authorization checks

### 🔑 OAuth Flows (Need Real Tokens)
- [ ] Google signup (new user)
- [ ] Google login (existing user)
- [ ] Facebook signup
- [ ] Facebook login
- [ ] Apple signup
- [ ] Apple login

### 📱 Phone OTP (Need Twilio)
- [ ] Send OTP
- [ ] Verify OTP (signup)
- [ ] Verify OTP (login existing)

### 👤 User Flows (Need Access Token)
- [ ] Get user info (`/me`)
- [ ] Update preferences (with location)
- [ ] Update preferences (without location)
- [ ] Get live meetings count

### 🔄 Token Management (Need Tokens)
- [ ] Refresh access token
- [ ] Logout
- [ ] Verify refresh fails after logout

### ❌ Error Cases
- [x] Signup without accepting terms → Should fail
- [ ] Invalid OAuth tokens → Should fail
- [ ] Invalid OTP → Should fail
- [x] Missing authorization header → Should fail
- [ ] Expired access token → Should fail

---

## 🛠️ Helper Script

### Quick Test with `test-e2e.sh` (Recommended)

The easiest way to test all token-based flows:

```bash
cd apps/auth-service
./test-e2e.sh
```

The script will:
1. ✅ Check if the service is running
2. ✅ Ask for your access and refresh tokens (interactive)
3. ✅ Test all token-based flows automatically:
   - Get user info
   - Update preferences (with and without location)
   - Refresh access token
   - Logout
   - Verify token invalidation

**Getting Tokens:**
- **Easiest way**: Run `./test-full-flow.sh` first - it will get tokens from Google OAuth and automatically run the e2e tests
- **Manual**: Get tokens from OAuth flows (see sections below) and paste them when prompted
- **📖 Detailed guide**: See `HOW_TO_GET_TOKENS.md` for complete instructions on all methods

**Alternative Usage:**
```bash
# Pass tokens as arguments
./test-e2e.sh ACCESS_TOKEN REFRESH_TOKEN

# Or as environment variables
export ACCESS_TOKEN="..."
export REFRESH_TOKEN="..."
./test-e2e.sh
```

---

## 💡 Tips

1. **Save tokens in environment variables** for easy reuse:
   ```bash
   export ACCESS_TOKEN="..."
   export REFRESH_TOKEN="..."
   ```

2. **Use `jq` for pretty JSON output**:
   ```bash
   curl ... | jq .
   ```

3. **Test error cases** to ensure proper error handling

4. **Check database** to verify data is saved correctly:
   ```bash
   psql -d hmm_auth -c "SELECT * FROM \"User\" LIMIT 5;"
   ```

5. **Check Redis** for metrics:
   ```bash
   redis-cli GET live_meetings_count
   ```

---

## 🐛 Troubleshooting

### "Invalid token" errors
- Token might be expired (access tokens expire in 15 minutes)
- Token format might be wrong
- JWT keys might have changed

### OAuth verification fails
- Check `GOOGLE_CLIENT_ID` matches the token's audience
- Verify token hasn't expired
- Ensure token is from the correct provider

### Database errors
- Run `npm run prisma:push` to sync schema
- Check `DATABASE_URL` is correct

### Redis errors
- Ensure Redis is running: `redis-cli ping`
- Check `REDIS_URL` in `.env`

