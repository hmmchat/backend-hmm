# How to Get a Google OAuth Token for Testing

## Quick Method: Google OAuth Playground

### Step 1: Get Your Google Client ID

1. Check your `.env` file for `GOOGLE_CLIENT_ID` or `GOOGLE_AUD`
2. If you don't have one, you can:
   - Use a test client ID (for testing only)
   - Create one at https://console.cloud.google.com/apis/credentials

### Step 2: Use OAuth Playground

1. **Go to OAuth Playground**: https://developers.google.com/oauthplayground/

2. **Configure OAuth Playground**:
   - Click the gear icon (⚙️) in the top right
   - Check "Use your own OAuth credentials"
   - Enter your `GOOGLE_CLIENT_ID` in "OAuth Client ID"
   - Enter your `GOOGLE_CLIENT_SECRET` in "OAuth Client secret" (if you have it)
   - Click "Close"

3. **Select Scopes**:
   - In the left panel, find "Google OAuth2 API v2"
   - Select: `https://www.googleapis.com/auth/userinfo.email`
   - Select: `https://www.googleapis.com/auth/userinfo.profile`
   - Click "Authorize APIs"

4. **Authorize**:
   - Sign in with your Google account
   - Click "Allow" to grant permissions

5. **Get ID Token**:
   - After authorization, you'll see an authorization code
   - Click "Exchange authorization code for tokens"
   - Look for `id_token` in the response (it's a long JWT string)
   - Copy the `id_token` value

### Step 3: Test with Your Service

Use the `id_token` you got:

```bash
curl -X POST http://localhost:3001/auth/google \
  -H "Content-Type: application/json" \
  -d '{
    "idToken": "YOUR_ID_TOKEN_HERE",
    "acceptedTerms": true,
    "acceptedTermsVer": "v1.0"
  }' | jq .
```

You should get back `accessToken` and `refreshToken`.

---

## Alternative: Test Without Real Google Client ID

If you don't have a Google Client ID set up, you can:

1. **Skip OAuth for now** and test other flows
2. **Use a mock/test approach** (requires code changes)
3. **Set up Google OAuth properly** (recommended for production)

---

## Troubleshooting

### "Invalid audience" error
- Make sure the `id_token` was issued for your `GOOGLE_CLIENT_ID`
- The token's `aud` claim must match your client ID

### "Token expired" error
- Google ID tokens expire quickly (usually 1 hour)
- Get a fresh token from OAuth Playground

### "Wrong number of segments"
- Make sure you're using the `id_token`, not `access_token`
- ID tokens are JWTs with 3 parts separated by dots

