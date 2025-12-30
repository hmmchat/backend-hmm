# How to Get Access and Refresh Tokens

## 🎯 Quick Answer

**Access and Refresh tokens are returned by the authentication endpoints** when you successfully sign up or log in.

---

## 🚀 Easiest Way: Use `test-full-flow.sh`

The simplest way to get tokens is to run:

```bash
cd apps/auth-service
./test-full-flow.sh
```

This script will:
1. Guide you to get a Google ID token from OAuth Playground
2. Call `/auth/google` with your ID token
3. **Automatically extract and use the access and refresh tokens**
4. Run all the e2e tests automatically

**The tokens are shown in the response** when the script successfully authenticates.

---

## 📋 Manual Methods

### Method 1: Google OAuth (Recommended for Testing)

1. **Get a Google ID Token** (see `GET_GOOGLE_TOKEN.md` or follow `test-full-flow.sh` instructions)

2. **Call the Google auth endpoint:**
   ```bash
   curl -X POST http://localhost:3001/auth/google \
     -H "Content-Type: application/json" \
     -d '{
       "idToken": "YOUR_GOOGLE_ID_TOKEN",
       "acceptedTerms": true,
       "acceptedTermsVer": "v1.0"
     }' | jq .
   ```

3. **Response contains both tokens:**
   ```json
   {
     "accessToken": "eyJ...",
     "refreshToken": "eyJ..."
   }
   ```

4. **Save them:**
   ```bash
   # Extract and save tokens
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

---

### Method 2: Facebook OAuth

**Step-by-step instructions:**

1. **Go to Facebook Graph API Explorer:**
   - Open: https://developers.facebook.com/tools/explorer/
   - You don't need to create an app - you can use the default "Graph API Explorer" app

2. **Get User Access Token:**
   - Click "Get Token" button (top right)
   - Select "Get User Access Token"
   - In the popup, check these permissions:
     - `email`
     - `public_profile`
   - Click "Get Access Token"
   - Sign in with Facebook if prompted
   - Click "Continue" to allow permissions

3. **Copy the Access Token:**
   - The token will appear in the "Access Token" field (top of the page)
   - Copy this token (it's a long string)

4. **Call the Facebook auth endpoint:**
   ```bash
   curl -X POST http://localhost:3001/auth/facebook \
     -H "Content-Type: application/json" \
     -d '{
       "accessToken": "YOUR_FACEBOOK_ACCESS_TOKEN",
       "acceptedTerms": true,
       "acceptedTermsVer": "v1.0"
     }' | jq .
   ```

5. **Response contains both tokens:**
   ```json
   {
     "accessToken": "eyJ...",
     "refreshToken": "eyJ..."
   }
   ```

6. **Save them:**
   ```bash
   # Extract and save tokens
   RESPONSE=$(curl -s -X POST http://localhost:3001/auth/facebook \
     -H "Content-Type: application/json" \
     -d '{
       "accessToken": "YOUR_FACEBOOK_ACCESS_TOKEN",
       "acceptedTerms": true,
       "acceptedTermsVer": "v1.0"
     }')
   
   export ACCESS_TOKEN=$(echo "$RESPONSE" | jq -r '.accessToken')
   export REFRESH_TOKEN=$(echo "$RESPONSE" | jq -r '.refreshToken')
   
   echo "Access Token: $ACCESS_TOKEN"
   echo "Refresh Token: $REFRESH_TOKEN"
   ```

**Note:** Facebook tokens from Graph API Explorer expire in 1-2 hours. For production, you'll need to set up a proper Facebook App.

---

### Method 3: Apple Sign-In

**Note:** Apple Sign-In requires a real Apple Developer account and app setup. For testing, you'll need either:
- An iOS/macOS app with Apple Sign-In implemented
- A web app with Apple Sign-In configured

**Step-by-step instructions (Web-based approach):**

1. **Prerequisites:**
   - Apple Developer account (free or paid)
   - Your app's Bundle ID or Service ID configured in Apple Developer Portal
   - `APPLE_AUD` environment variable set in your `.env` file (located at `apps/auth-service/.env`)

2. **Set up Apple Sign-In in Apple Developer Portal:**
   - Go to: https://developer.apple.com/account/
   - Navigate to "Certificates, Identifiers & Profiles"
   - Create or select your App ID
   - Enable "Sign In with Apple" capability
   - Configure your Service ID (for web) or App ID (for native)
   - Note your Bundle ID / Service ID (this is your `APPLE_AUD`)

3. **Add to `.env` file:**
   - The `.env` file is located in: `apps/auth-service/.env`
   - Open the file and add:
   ```bash
   APPLE_AUD="your.bundle.id"  # Your Apple Bundle ID or Service ID
   ```

4. **Get Apple Identity Token:**
   - Implement Apple Sign-In in your web app or mobile app
   - When user signs in, Apple returns an `identityToken` (JWT)
   - Copy this token

5. **Call the Apple auth endpoint:**
   ```bash
   curl -X POST http://localhost:3001/auth/apple \
     -H "Content-Type: application/json" \
     -d '{
       "identityToken": "YOUR_APPLE_IDENTITY_TOKEN",
       "acceptedTerms": true,
       "acceptedTermsVer": "v1.0"
     }' | jq .
   ```

6. **Response contains both tokens:**
   ```json
   {
     "accessToken": "eyJ...",
     "refreshToken": "eyJ..."
   }
   ```

7. **Save them:**
   ```bash
   # Extract and save tokens
   RESPONSE=$(curl -s -X POST http://localhost:3001/auth/apple \
     -H "Content-Type: application/json" \
     -d '{
       "identityToken": "YOUR_APPLE_IDENTITY_TOKEN",
       "acceptedTerms": true,
       "acceptedTermsVer": "v1.0"
     }')
   
   export ACCESS_TOKEN=$(echo "$RESPONSE" | jq -r '.accessToken')
   export REFRESH_TOKEN=$(echo "$RESPONSE" | jq -r '.refreshToken')
   
   echo "Access Token: $ACCESS_TOKEN"
   echo "Refresh Token: $REFRESH_TOKEN"
   ```

**Alternative for Testing:** If you don't have an Apple Developer account, you can skip Apple testing and focus on Google/Facebook/Phone OTP for now.

---

### Method 4: Phone OTP (Requires Twilio)

**Step-by-step setup:**

1. **Create a Twilio Account:**
   - Go to: https://www.twilio.com/try-twilio
   - Sign up for a free account (includes $15.50 credit for testing)
   - Verify your email and phone number

2. **Get Twilio Credentials:**
   - After signing up, go to: https://console.twilio.com/
   - On the dashboard, you'll see:
     - **Account SID** (starts with `AC...`)
     - **Auth Token** (click "View" to reveal it)
   - Copy both values

3. **Create a Verify Service:**
   - In Twilio Console, go to: https://console.twilio.com/us1/develop/verify/services
   - Click "Create new Verify Service"
   - Enter a friendly name (e.g., "Auth Service")
   - Click "Create"
   - **Important:** After creating, you'll see verification channels (SMS, Voice, WhatsApp, Email)
   - **Enable SMS channel:**
     - Click on your newly created service to open it
     - Look for "Channels" or "Verification Channels" section
     - You'll see 4 channels: SMS, Voice, WhatsApp, Email (all may be disabled by default)
     - **Enable SMS** - Toggle the SMS channel to ON (this is required for phone OTP)
     - You can leave Voice, WhatsApp, and Email disabled (not needed for basic testing)
     - Save if prompted
   - Copy the **Service SID** (starts with `VA...`) from the service details page
   
   **Note:** If you don't see the channels section immediately, refresh the page or navigate to the service settings. SMS must be enabled for the phone OTP flow to work.

4. **Add credentials to `.env` file:**
   - The `.env` file is located in: `apps/auth-service/.env`
   - Open or create this file and add:
   ```bash
   TWILIO_ACCOUNT_SID="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
   TWILIO_AUTH_TOKEN="your_auth_token_here"
   TWILIO_VERIFY_SID="VA30a659fee09792d62288cb4b73d895a6"
   ```
   
   **Quick way to add:**
   ```bash
   cd apps/auth-service
   # Edit .env file and add the three lines above
   # Or use: echo 'TWILIO_ACCOUNT_SID="AC..."' >> .env
   ```

5. **Restart your auth service:**
   ```bash
   # Stop the service (Ctrl+C) and restart
   cd apps/auth-service
   npm run start:dev
   ```

6. **Send OTP to your phone:**
   ```bash
   # Replace with your Indian phone number (must start with +91, e.g., +918073656316)
   curl -X POST http://localhost:3001/auth/phone/send-otp \
     -H "Content-Type: application/json" \
     -d '{"phone": "+918073656316"}' | jq .
   ```

7. **Check your phone for the OTP code:**
   - You'll receive an SMS with a 6-digit code
   - The code is valid for 10 minutes

8. **Verify OTP and get tokens:**
   ```bash
   curl -X POST http://localhost:3001/auth/phone/verify \
     -H "Content-Type: application/json" \
     -d '{
       "phone": "+918073656316",
       "code": "123456",
       "acceptedTerms": true,
       "acceptedTermsVer": "v1.0"
     }' | jq .
   ```

9. **Response contains both tokens:**
   ```json
   {
     "accessToken": "eyJ...",
     "refreshToken": "eyJ..."
   }
   ```

10. **Save them:**
    ```bash
    # Extract and save tokens
    RESPONSE=$(curl -s -X POST http://localhost:3001/auth/phone/verify \
      -H "Content-Type: application/json" \
      -d '{
        "phone": "+918073656316",
        "code": "123456",
        "acceptedTerms": true,
        "acceptedTermsVer": "v1.0"
      }')
    
    export ACCESS_TOKEN=$(echo "$RESPONSE" | jq -r '.accessToken')
    export REFRESH_TOKEN=$(echo "$RESPONSE" | jq -r '.refreshToken')
    
    echo "Access Token: $ACCESS_TOKEN"
    echo "Refresh Token: $REFRESH_TOKEN"
    ```

**Note:** Twilio free trial includes $15.50 credit. Each SMS costs ~$0.0075, so you can send ~2000 messages for testing.

**Troubleshooting:**
- **If SMS channel is disabled:** Make sure you enabled it in step 3 above. Go back to your Verify Service settings and enable SMS.
- **If you get "Channel not enabled" error:** Check that SMS is enabled in your Verify Service settings.
- **If OTP doesn't arrive:** Check your phone number format (must be Indian number starting with +91, e.g., +918073656316).
- **Phone Number Restriction:** Only Indian phone numbers (+91) are accepted.

---

## 🔄 Getting a New Access Token (Token Refresh)

If your access token expires, you can get a new one using your refresh token:

```bash
curl -X POST http://localhost:3001/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "YOUR_REFRESH_TOKEN"
  }' | jq .
```

**Response:**
```json
{
  "accessToken": "eyJ..."  // New access token
}
```

**Note:** Refresh tokens last 30 days, access tokens expire in 15 minutes.

---

## 💡 Quick Reference

| Endpoint | Input | Output |
|----------|-------|--------|
| `POST /auth/google` | Google ID Token | `{ accessToken, refreshToken }` |
| `POST /auth/facebook` | Facebook Access Token | `{ accessToken, refreshToken }` |
| `POST /auth/apple` | Apple Identity Token | `{ accessToken, refreshToken }` |
| `POST /auth/phone/verify` | Phone + OTP Code | `{ accessToken, refreshToken }` |
| `POST /auth/refresh` | Refresh Token | `{ accessToken }` |

---

## 🎯 Recommended Workflow

1. **First time testing:**
   ```bash
   ./test-full-flow.sh
   ```
   This gets tokens automatically and runs all tests.

2. **If you already have tokens:**
   ```bash
   ./test-e2e.sh
   ```
   Paste your tokens when prompted.

3. **If tokens expired:**
   - Use `/auth/refresh` to get a new access token
   - Or run `./test-full-flow.sh` again to get fresh tokens

---

## 📝 Example: Complete Flow

```bash
# Step 1: Get Google ID token from OAuth Playground
# (Follow instructions in test-full-flow.sh)

# Step 2: Authenticate and get tokens
RESPONSE=$(curl -s -X POST http://localhost:3001/auth/google \
  -H "Content-Type: application/json" \
  -d '{
    "idToken": "YOUR_GOOGLE_ID_TOKEN",
    "acceptedTerms": true,
    "acceptedTermsVer": "v1.0"
  }')

# Step 3: Extract tokens
ACCESS_TOKEN=$(echo "$RESPONSE" | jq -r '.accessToken')
REFRESH_TOKEN=$(echo "$RESPONSE" | jq -r '.refreshToken')

# Step 4: Use tokens
echo "Access Token: $ACCESS_TOKEN"
echo "Refresh Token: $REFRESH_TOKEN"

# Step 5: Test with tokens
./test-e2e.sh "$ACCESS_TOKEN" "$REFRESH_TOKEN"
```

---

---

## 🎯 Which Method Should I Use?

**For Quick Testing (Recommended):**
1. **Google OAuth** - Easiest, no account setup needed (use OAuth Playground)
2. **Facebook OAuth** - Easy, no app setup needed (use Graph API Explorer)

**For Production-Like Testing:**
3. **Phone OTP** - Requires Twilio account (free trial available)
4. **Apple Sign-In** - Requires Apple Developer account and app setup

**Recommended Order for Testing:**
1. Start with Google OAuth (`./test-full-flow.sh`)
2. Then try Facebook OAuth (follow Method 2 above)
3. Then try Phone OTP (if you want to test SMS flows)
4. Apple Sign-In (only if you have Apple Developer account)

---

## 📊 Quick Comparison

| Method | Setup Time | Account Needed | Cost | Ease |
|--------|-----------|----------------|------|------|
| Google OAuth | 2 minutes | No | Free | ⭐⭐⭐⭐⭐ |
| Facebook OAuth | 3 minutes | Facebook account | Free | ⭐⭐⭐⭐⭐ |
| Phone OTP | 10 minutes | Twilio account | Free trial | ⭐⭐⭐⭐ |
| Apple Sign-In | 30+ minutes | Apple Developer | Free/Paid | ⭐⭐ |

---

## ❓ Common Questions

**Q: Where are tokens stored?**  
A: Tokens are returned in the API response. You need to save them yourself (environment variables, file, etc.)

**Q: How long do tokens last?**  
A: Access tokens expire in 15 minutes. Refresh tokens last 30 days.

**Q: Can I reuse tokens?**  
A: Yes, until they expire. Use the refresh token to get new access tokens.

**Q: What if I lose my tokens?**  
A: Just authenticate again using any OAuth method to get new tokens.

**Q: Do I need to test all methods?**  
A: No! Start with Google OAuth. Test other methods only if you need to verify those specific flows.

**Q: Can I use the same tokens for multiple test runs?**  
A: Yes, as long as they haven't expired. Access tokens last 15 minutes, refresh tokens last 30 days.

