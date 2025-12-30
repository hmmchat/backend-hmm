# Test Full Authentication Flow - Simple Guide

## 🚀 Quick Start (Easiest Way)

Just run the script and follow the prompts - it's that simple!

```bash
cd apps/auth-service
./test-full-flow.sh
```

The script will:
1. ✅ Check if the service is running
2. ✅ Automatically configure Google OAuth (uses OAuth Playground default - no setup needed!)
3. ✅ Guide you step-by-step to get a Google ID token
4. ✅ Test the full authentication flow
5. ✅ Run all end-to-end tests automatically

---

## 📋 What You'll Need to Do

### Step 1: Make sure the service is running

```bash
cd apps/auth-service
npm run start:dev
```

### Step 2: Run the test script

```bash
./test-full-flow.sh
```

### Step 3: Get Google ID Token (the script will guide you)

When prompted, you'll need to:

1. Open: https://developers.google.com/oauthplayground/
2. Find "Google OAuth2 API v2" in the left panel
3. Select these scopes:
   - `https://www.googleapis.com/auth/userinfo.email`
   - `https://www.googleapis.com/auth/userinfo.profile`
4. Click "Authorize APIs"
5. Sign in with Google
6. Click "Allow"
7. Click "Exchange authorization code for tokens"
8. Copy the `id_token` value (long JWT string starting with `eyJ...`)
9. Paste it when the script asks

That's it! The script handles everything else automatically.

---

## 💡 How It Works

- **No Google Cloud setup needed** - The script automatically uses OAuth Playground's default client ID
- **No configuration required** - If `GOOGLE_CLIENT_ID` isn't in your `.env`, the script uses the playground default
- **Fully automated** - After you paste the ID token, the script tests everything automatically

---

## 🔧 Optional: Make OAuth Playground Client ID Permanent

If you want to avoid the auto-configuration message each time, add this to your `.env`:

```bash
GOOGLE_CLIENT_ID="407408718192.apps.googleusercontent.com"
```

Then restart your service. The script will detect it and use it automatically.

