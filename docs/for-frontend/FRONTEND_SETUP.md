# Backend Setup Guide for Frontend Team

Simple step-by-step guide to run the auth service backend locally.

---

## ⚡ Quick Start (5 minutes)

### Prerequisites Check

Before starting, make sure you have:
- ✅ **Node.js** (v18 or higher) - [Download](https://nodejs.org/)
- ✅ **PostgreSQL** - [Download](https://www.postgresql.org/download/)
- ✅ **Redis** - [Download](https://redis.io/download)

**Check if installed:**
```bash
node --version    # Should show v18+ or v20+
psql --version    # Should show PostgreSQL version
redis-cli --version  # Should show Redis version
```

---

## 📦 Step 1: Clone Repository

```bash
git clone <repository-url>
cd backend-hmm
```

---

## 🔧 Step 2: Install Dependencies

```bash
cd apps/auth-service
npm install
```

**Wait for installation to complete** (may take 1-2 minutes)

---

## ⚙️ Step 3: Set Up Environment Variables

Create a `.env` file in `apps/auth-service/` directory:

```bash
cd apps/auth-service
touch .env
```

Open `.env` file and add these variables (ask backend team for values):

```bash
# Server
PORT=3001
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173

# Database
DATABASE_URL="postgresql://username:password@localhost:5432/database_name?schema=public"

# JWT Keys (ask backend team for these)
JWT_PUBLIC_JWK='{"kty":"EC","crv":"P-256","x":"...","y":"..."}'
JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"

# Redis
REDIS_URL="redis://localhost:6379"

# OAuth (optional - only if testing OAuth)
GOOGLE_CLIENT_ID="your-google-client-id"
APPLE_AUD="your-apple-bundle-id"

# Twilio (optional - only if testing phone OTP)
TWILIO_ACCOUNT_SID="your-twilio-sid"
TWILIO_AUTH_TOKEN="your-twilio-token"
TWILIO_VERIFY_SID="your-twilio-verify-sid"
```

**💡 Tip:** Ask the backend team for a `.env.example` file or the actual values.

---

## 🗄️ Step 4: Set Up Database

### 4.1 Create Database

```bash
# Connect to PostgreSQL
psql postgres

# Create database (in psql prompt)
CREATE DATABASE hmm_auth;

# Exit psql
\q
```

### 4.2 Set Up Database Schema

```bash
cd apps/auth-service

# Generate Prisma client
npm run prisma:generate

# Create database tables
npm run prisma:push
```

**✅ Success:** You should see "Database synchronized successfully"

---

## 🔴 Step 5: Start Redis

**Mac (using Homebrew):**
```bash
brew services start redis
```

**Or run directly:**
```bash
redis-server
```

**Verify Redis is running:**
```bash
redis-cli ping
# Should return: PONG
```

**💡 Tip:** Keep Redis running in a separate terminal, or use `brew services start redis` to run it in the background.

---

## 🚀 Step 6: Start Backend Service

```bash
cd apps/auth-service
npm run start:dev
```

**✅ Success:** You should see:
```
🚀 Auth service running on http://localhost:3001
```

**Keep this terminal open** - the service runs here.

---

## ✅ Step 7: Verify It's Working

Open a **new terminal** and run:

```bash
curl http://localhost:3001/me/metrics
```

**Expected response:**
```json
{"liveMeetings":0}
```

If you see this, **backend is running successfully!** ✅

---

## 🎯 Connect Your Frontend

Now you can connect your frontend application to:

```
http://localhost:3001
```

**Example API call:**
```javascript
fetch('http://localhost:3001/me/metrics')
  .then(res => res.json())
  .then(data => console.log(data));
```

---

## 📚 Next Steps

1. **Read API Documentation:** See `FRONTEND_INTEGRATION.md`
2. **Start Integrating:** Use the endpoints documented there
3. **Test:** Try the API endpoints with your frontend

---

## ❓ Troubleshooting

### "Port 3001 already in use"
**Solution:** Another service is using port 3001. Either:
- Stop the other service
- Change PORT in `.env` to a different number (e.g., 3002)

### "Database connection failed"
**Solution:** 
- Check PostgreSQL is running: `psql -l`
- Verify `DATABASE_URL` in `.env` is correct
- Make sure database exists: `psql -l | grep hmm_auth`

### "Redis connection failed"
**Solution:**
- Check Redis is running: `redis-cli ping`
- Start Redis: `brew services start redis` (Mac) or `redis-server`

### "Prisma client not generated"
**Solution:**
```bash
cd apps/auth-service
npm run prisma:generate
```

### "Module not found" errors
**Solution:**
```bash
cd apps/auth-service
rm -rf node_modules
npm install
```

---

## 🛑 Stopping the Service

**To stop the backend:**
- Press `Ctrl + C` in the terminal where it's running

**To stop Redis:**
```bash
brew services stop redis  # Mac
# or
redis-cli shutdown
```

---

## 📝 Quick Reference

**Start everything:**
```bash
# Terminal 1: Start Redis
brew services start redis

# Terminal 2: Start backend
cd apps/auth-service
npm run start:dev
```

**Check if running:**
```bash
curl http://localhost:3001/me/metrics
```

**Base URL for frontend:**
```
http://localhost:3001
```

---

## 🆘 Need Help?

**Common Issues:**
- Check `TROUBLESHOOTING` section above
- Verify all prerequisites are installed
- Check `.env` file has all required variables

**Still stuck?**
- Contact the backend team
- Share the error message you're seeing
- Mention which step you're on

---

## ✅ Setup Checklist

- [ ] Node.js installed (v18+)
- [ ] PostgreSQL installed and running
- [ ] Redis installed and running
- [ ] Repository cloned
- [ ] Dependencies installed (`npm install`)
- [ ] `.env` file created with all variables
- [ ] Database created
- [ ] Database schema set up (`npm run prisma:push`)
- [ ] Backend service running (`npm run start:dev`)
- [ ] Verified with `curl http://localhost:3001/me/metrics`

**All checked?** You're ready to integrate! 🎉

