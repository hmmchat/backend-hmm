# Quick Token Setup for Automated Tests

To run auth-service tests automatically, save your Google ID token using one of these methods:

## Quick Setup (Choose One)

### Option 1: Environment Variable
```bash
export GOOGLE_ID_TOKEN='eyJhbGciOiJSUzI1NiIsImtpZCI6IjEyMzQ1NiJ9.your_token_here...'
```

### Option 2: Token File (Recommended)
```bash
# Save token to file (will be gitignored)
echo 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjEyMzQ1NiJ9.your_token_here...' > tests/auth-service/.test-token
```

Then run:
```bash
cd tests/auth-service
./test-auth-service.sh
```

## Getting a Token

1. Go to https://developers.google.com/oauthplayground/
2. Expand "Google OAuth2 API v2"
3. Select: `userinfo.email` and `userinfo.profile` scopes
4. Click "Authorize APIs" → Sign in → Allow
5. Click "Exchange authorization code for tokens"
6. Copy the `id_token` value (JWT starting with 'eyJ...')

See `HOW_TO_GET_TOKENS.md` for detailed instructions.
