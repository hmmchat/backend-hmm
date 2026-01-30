# Frontend Setup Guide

Complete guide to set up and run the backend services for frontend development.

## 📋 Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** v22 or higher
- **PostgreSQL** 14+ (running locally or accessible)
- **Redis** (optional, for caching and metrics)
- **npm** or **pnpm** package manager

## 🚀 Quick Start

### 1. Clone and Install

```bash
# Clone the repository
git clone <repository-url>
cd backend-hmm

# Install dependencies
npm ci
```

### 2. Environment Setup

Each service requires environment variables. Copy the example files and configure:

```bash
# Copy example env files (if they exist)
# Most services use .env files in their respective directories
```

**Key Environment Variables:**

- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string (optional)
- `JWT_SECRET` / `JWT_PUBLIC_JWK` - JWT signing keys
- `TWILIO_*` - For phone OTP (auth-service)
- `CLOUDFLARE_R2_*` - For file storage (files-service)
- `RAZORPAY_*` - For payments (payment-service)

### 3. Database Setup

```bash
# Setup databases for all services
# Each service has its own database schema

# Example for user-service
cd apps/user-service
npx prisma generate
npx prisma db push
npx prisma db seed  # If seed script exists

# Repeat for other services that need database setup
```

### 4. Start Services

**Option A: Start All Services (Recommended)**

```bash
# From root directory
npm run dev

# Or start services individually in separate terminals
```

**Option B: Start Services Individually**

```bash
# Terminal 1 - API Gateway
cd apps/api-gateway
npm run start:dev

# Terminal 2 - Auth Service
cd apps/auth-service
npm run start:dev

# Terminal 3 - User Service
cd apps/user-service
npm run start:dev

# Terminal 4 - Discovery Service
cd apps/discovery-service
npm run start:dev

# Terminal 5 - Streaming Service
cd apps/streaming-service
npm run start:dev

# Terminal 6 - Files Service
cd apps/files-service
npm run start:dev

# Terminal 7 - Wallet Service
cd apps/wallet-service
npm run start:dev

# Terminal 8 - Payment Service
cd apps/payment-service
npm run start:dev

# Terminal 9 - Friend Service
cd apps/friend-service
npm run start:dev

# Terminal 10 - Moderation Service
cd apps/moderation-service
npm run start:dev

# Terminal 11 - Ads Service
cd apps/ads-service
npm run start:dev
```

## 🌐 Service Ports

| Service | Port | Base URL |
|---------|------|----------|
| API Gateway | 3000 | `http://localhost:3000` |
| Auth Service | 3001 | `http://localhost:3001` |
| User Service | 3002 | `http://localhost:3002` |
| Moderation Service | 3003 | `http://localhost:3003` |
| Discovery Service | 3004 | `http://localhost:3004` |
| Streaming Service | 3006 | `http://localhost:3006` |
| Wallet Service | 3005 | `http://localhost:3005` |
| Payment Service | 3007 | `http://localhost:3007` |
| Friend Service | 3009 | `http://localhost:3009` |
| Files Service | 3008 | `http://localhost:3008` |
| Ads Service | 3010 | `http://localhost:3010` |

## 🔧 Configuration

### API Gateway (Recommended)

The API Gateway provides a single entry point for all requests:

- **Base URL:** `http://localhost:3000`
- **All endpoints:** `/v1/*`
- **Benefits:**
  - Single base URL
  - Centralized authentication
  - Rate limiting
  - Request aggregation

### Direct Service Access

If not using API Gateway, call services directly using their individual ports.

## ✅ Verification

### Health Checks

```bash
# Check API Gateway
curl http://localhost:3000/health

# Check individual services
curl http://localhost:3001/health  # Auth
curl http://localhost:3002/health   # User
curl http://localhost:3004/health   # Discovery
# ... etc
```

### Test Authentication

```bash
# Test Google sign-in endpoint
curl -X POST http://localhost:3000/v1/auth/google \
  -H "Content-Type: application/json" \
  -d '{
    "idToken": "test-token",
    "acceptedTerms": true,
    "acceptedTermsVer": "v1.0"
  }'
```

## 🐛 Troubleshooting

### Common Issues

**1. Port Already in Use**
```bash
# Find and kill process using port
lsof -ti:3000 | xargs kill -9

# Or change port in service's .env file
```

**2. Database Connection Error**
- Ensure PostgreSQL is running
- Check `DATABASE_URL` in service's `.env`
- Verify database exists and user has permissions

**3. Prisma Client Not Generated**
```bash
cd apps/<service-name>
npx prisma generate
```

**4. JWT Errors**
- Ensure `JWT_PUBLIC_JWK` and `JWT_SECRET` are set correctly
- Check JWT format in environment variables

**5. Service Not Starting**
- Check service logs for errors
- Verify all environment variables are set
- Ensure dependencies are installed (`npm ci`)

### Logs

Check service logs for detailed error messages:

```bash
# If using npm run dev, logs appear in terminal
# Check for error messages and stack traces
```

## 📚 Next Steps

1. **Read `FRONTEND_INTEGRATION.md`** - Complete API documentation
2. **Set up authentication** - Get access tokens
3. **Test endpoints** - Use provided examples
4. **Start building** - Integrate with your frontend

## 🔐 Authentication Setup

For local development, you'll need:

1. **Google OAuth** - Get Google OAuth client ID
2. **Apple Sign-In** - Configure Apple Developer account
3. **Facebook Login** - Get Facebook App ID
4. **Twilio** - For phone OTP (optional for local dev)

See `FRONTEND_INTEGRATION.md` for detailed authentication flows.

## 📝 Notes

- Services are designed to work independently
- Some services depend on others (e.g., discovery needs user-service)
- Moderation service is called automatically by user-service
- All services use JWT for authentication
- File uploads go through files-service to Cloudflare R2

## 🆘 Support

If you encounter issues:

1. Check service logs
2. Verify environment variables
3. Ensure all prerequisites are installed
4. Check database connectivity
5. Review `FRONTEND_INTEGRATION.md` for API details

---

**Ready to integrate?** See `FRONTEND_INTEGRATION.md` for complete API documentation.
