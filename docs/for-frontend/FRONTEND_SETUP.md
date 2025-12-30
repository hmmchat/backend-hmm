# Backend Setup Guide for Frontend Team

Simple step-by-step guide to run all backend services locally.

---

## ⚡ Quick Start

### Services Overview

You'll need to run **3 backend services**:

| Service | Port | Purpose |
|---------|------|---------|
| **Auth Service** | 3001 | Authentication, OAuth, tokens |
| **User Service** | 3002 | User profiles, photos, preferences |
| **Moderation Service** | 3003 | Photo validation (human detection, NSFW check) |

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

Install dependencies for all services:

```bash
# Auth Service
cd apps/auth-service
npm install
cd ../..

# User Service
cd apps/user-service
npm install
cd ../..

# Moderation Service
cd apps/moderation-service
npm install
cd ../..
```

**Wait for installation to complete** (may take 2-3 minutes)

---

## ⚙️ Step 3: Set Up Environment Variables

### 3.1 Auth Service

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
DATABASE_URL="postgresql://username:password@localhost:5432/hmm_auth?schema=public"

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

### 3.2 User Service

Create a `.env` file in `apps/user-service/` directory:

```bash
cd apps/user-service
touch .env
```

Open `.env` file and add these variables (ask backend team for values):

```bash
# Server
PORT=3002
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173

# Database
DATABASE_URL="postgresql://username:password@localhost:5432/hmm_user?schema=public"

# JWT (same as auth-service)
JWT_PUBLIC_JWK='{"kty":"EC","crv":"P-256","x":"...","y":"..."}'

# Moderation Service URL
MODERATION_SERVICE_URL=http://localhost:3003
```

### 3.3 Moderation Service

Create a `.env` file in `apps/moderation-service/` directory:

```bash
cd apps/moderation-service
touch .env
```

Open `.env` file and add these variables (ask backend team for values):

```bash
# Server
PORT=3003
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173

# Moderation Provider (mock, sightengine, google-vision, aws-rekognition)
MODERATION_PROVIDER=mock

# Optional: Provider API keys (only if not using mock)
SIGHTENGINE_API_USER="your-sightengine-user"
SIGHTENGINE_API_SECRET="your-sightengine-secret"
GOOGLE_CLOUD_PROJECT_ID="your-gcp-project"
GOOGLE_CLOUD_KEY_FILE="path/to/key.json"
AWS_ACCESS_KEY_ID="your-aws-key"
AWS_SECRET_ACCESS_KEY="your-aws-secret"
AWS_REGION="us-east-1"
```

**💡 Tip:** Ask the backend team for `.env.example` files or the actual values.

---

## 🗄️ Step 4: Set Up Databases

### 4.1 Create Databases

```bash
# Connect to PostgreSQL
psql postgres

# Create databases (in psql prompt)
CREATE DATABASE hmm_auth;
CREATE DATABASE hmm_user;

# Exit psql
\q
```

### 4.2 Set Up Auth Service Database Schema

```bash
cd apps/auth-service

# Generate Prisma client
npm run prisma:generate

# Create database tables
npm run prisma:push
```

**✅ Success:** You should see "Database synchronized successfully"

### 4.3 Set Up User Service Database Schema

```bash
cd apps/user-service

# Generate Prisma client
npm run prisma:generate

# Create database tables
npm run prisma:push

# Seed initial data (brands, interests, values)
npm run seed
```

**✅ Success:** You should see "Database synchronized successfully" and seed completion messages

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

## 🚀 Step 6: Start All Services

You'll need **3 terminals** to run all services:

**Terminal 1: Auth Service**
```bash
cd apps/auth-service
npm run start:dev
```

**✅ Success:** You should see:
```
🚀 Auth service running on http://localhost:3001
```

**Terminal 2: User Service**
```bash
cd apps/user-service
npm run start:dev
```

**✅ Success:** You should see:
```
🚀 User service running on http://localhost:3002
```

**Terminal 3: Moderation Service**
```bash
cd apps/moderation-service
npm run start:dev
```

**✅ Success:** You should see:
```
🚀 Moderation service running on http://localhost:3003
```

**Keep all terminals open** - the services run here.

---

## ✅ Step 7: Verify All Services Are Working

Open a **new terminal** and run:

```bash
# Check auth service
curl http://localhost:3001/me/metrics
# Expected: {"liveMeetings":0}

# Check user service
curl http://localhost:3002/users/test123
# Expected: 404 (user not found, but service is up)

# Check moderation service
curl -X POST http://localhost:3003/moderation/check-image \
  -H "Content-Type: application/json" \
  -d '{"imageUrl": "https://example.com/test.jpg"}'
# Expected: JSON response with moderation result
```

If all services respond, **backend is running successfully!** ✅

---

## 🎯 Connect Your Frontend

Now you can connect your frontend application to:

- **Auth Service:** `http://localhost:3001`
- **User Service:** `http://localhost:3002`
- **Moderation Service:** `http://localhost:3003` (called automatically by user-service)

**Example API calls:**
```javascript
// Check auth service
fetch('http://localhost:3001/me/metrics')
  .then(res => res.json())
  .then(data => console.log(data));

// Get brands from user service
fetch('http://localhost:3002/brands')
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

### "Port 3001/3002/3003 already in use"
**Solution:** Another service is using the port. Either:
- Stop the other service
- Change PORT in the respective `.env` file to a different number

### "Database connection failed"
**Solution:** 
- Check PostgreSQL is running: `psql -l`
- Verify `DATABASE_URL` in `.env` is correct
- Make sure databases exist: `psql -l | grep hmm_auth` and `psql -l | grep hmm_user`

### "Redis connection failed"
**Solution:**
- Check Redis is running: `redis-cli ping`
- Start Redis: `brew services start redis` (Mac) or `redis-server`

### "Prisma client not generated"
**Solution:**
```bash
# For auth service
cd apps/auth-service
npm run prisma:generate

# For user service
cd apps/user-service
npm run prisma:generate
```

### "Seed data not found" (user-service)
**Solution:**
```bash
cd apps/user-service
npm run seed
```

### "Module not found" errors
**Solution:**
```bash
# For the affected service
cd apps/<service-name>
rm -rf node_modules
npm install
```

---

## 🛑 Stopping the Services

**To stop the backend services:**
- Press `Ctrl + C` in each terminal where services are running

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

# Terminal 2: Start auth service
cd apps/auth-service
npm run start:dev

# Terminal 3: Start user service
cd apps/user-service
npm run start:dev

# Terminal 4: Start moderation service
cd apps/moderation-service
npm run start:dev
```

**Check if running:**
```bash
curl http://localhost:3001/me/metrics  # Auth service
curl http://localhost:3002/brands      # User service
curl -X POST http://localhost:3003/moderation/check-image \
  -H "Content-Type: application/json" \
  -d '{"imageUrl": "https://example.com/test.jpg"}'  # Moderation service
```

**Base URLs for frontend:**
- Auth Service: `http://localhost:3001`
- User Service: `http://localhost:3002`
- Moderation Service: `http://localhost:3003` (internal use only)

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
- [ ] Dependencies installed for all services (`npm install`)
- [ ] `.env` files created for all services with all variables
- [ ] Databases created (`hmm_auth` and `hmm_user`)
- [ ] Auth service database schema set up (`npm run prisma:push`)
- [ ] User service database schema set up (`npm run prisma:push`)
- [ ] User service seed data populated (`npm run seed`)
- [ ] All 3 backend services running (`npm run start:dev`)
- [ ] All services verified with curl commands

**All checked?** You're ready to integrate! 🎉

