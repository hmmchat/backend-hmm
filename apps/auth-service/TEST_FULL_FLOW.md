# Step-by-Step: Test Full Authentication Flow

## Option 1: Quick Test with OAuth Playground (Recommended)

### Step 1: Get Google ID Token

**Easiest way - No Google Cloud setup needed:**

1. Go to: https://developers.google.com/oauthplayground/
2. **Don't configure credentials** - just use the playground's default
3. In left panel, find "Google OAuth2 API v2"
4. Select these scopes:
   - `https://www.googleapis.com/auth/userinfo.email`
   - `https://www.googleapis.com/auth/userinfo.profile`
5. Click **"Authorize APIs"** button
6. Sign in with your Google account
7. Click **"Allow"**
8. Click **"Exchange authorization code for tokens"**
9. **Copy the `id_token`** (it's a long JWT string starting with `eyJ...`)

**Note:** This token will work for testing, but you'll need to set `GOOGLE_CLIENT_ID` in your `.env` to match the playground's client ID, OR we can test with a different approach.

### Step 2: Set Google Client ID (if needed)

The OAuth Playground uses a default client ID. To use it:

```bash
# Add to .env (the playground's client ID)
GOOGLE_CLIENT_ID="407408718192.apps.googleusercontent.com"
```

OR use your own Google Client ID from Google Cloud Console.

### Step 3: Test Signup/Login

```bash
# Replace YOUR_ID_TOKEN with the token from step 1
curl -X POST http://localhost:3001/auth/google \
  -H "Content-Type: application/json" \
  -d '{
    "idToken": "YOUR_ID_TOKEN",
    "acceptedTerms": true,
    "acceptedTermsVer": "v1.0"
  }' | jq .
```

**Expected Response:**
```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ..."
}
```

### Step 4: Save Tokens and Test Full Flow

```bash
# Save tokens to variables
export ACCESS_TOKEN="your_access_token_here"
export REFRESH_TOKEN="your_refresh_token_here"

# Run end-to-end tests
./test-e2e.sh
```

---

## Option 2: Test Token-Based Flows Only (Without OAuth)

If you want to test the user flows without OAuth, you can manually create tokens (for testing only):

**Note:** This requires modifying the code temporarily or using a test token generator. Not recommended for production testing.

---

## Option 3: Use Your Own Google Client ID

1. Go to: https://console.cloud.google.com/
2. Create a new project (or use existing)
3. Enable "Google+ API" or "People API"
4. Go to "Credentials" → "Create Credentials" → "OAuth 2.0 Client ID"
5. Choose "Web application"
6. Add authorized redirect URI: `https://developers.google.com/oauthplayground`
7. Copy the Client ID
8. Add to `.env`: `GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"`
9. Restart the service
10. Use OAuth Playground with your own credentials (gear icon → use your own)

---

## Quick Test Script

I'll create an interactive script to help you through this process.

