# Quick Start Guide

## 1. Setup Environment

Create a `.env` file in `apps/streaming-service/`:

```env
# Enable test mode (bypasses authentication)
TEST_MODE=true
NODE_ENV=test

# Server
PORT=3005
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/streaming_db

# Mediasoup (for local testing, defaults are fine)
MEDIASOUP_WORKERS=2
MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_ANNOUNCED_IP=127.0.0.1

# Room Configuration
MAX_PARTICIPANTS_PER_CALL=4
```

## 2. Install Dependencies

```bash
cd apps/streaming-service
npm install
```

## 3. Setup Database

```bash
# Generate Prisma client
npm run prisma:generate

# Push schema to database (development)
npm run prisma:push
```

## 4. Start Service

```bash
npm run start:dev
```

You should see:
```
🚀 Streaming service running on http://localhost:3005
⚠️  TEST MODE ENABLED - Authentication is bypassed
```

## 5. Test It!

### Quick Test (Create Room)

```bash
curl -X POST http://localhost:3005/streaming/rooms \
  -H "Content-Type: application/json" \
  -d '{"userIds": ["user-1", "user-2"]}'
```

### WebSocket Test

In one terminal:
```bash
npm run test:websocket user-1 YOUR_ROOM_ID
```

In another terminal:
```bash
npm run test:websocket user-2 YOUR_ROOM_ID
```

### Full Test

```bash
npm run test:call
```

## What's Different in Test Mode?

- ✅ No JWT tokens required
- ✅ WebSocket: Pass `?userId=user-123` in URL
- ✅ REST API: Include `fromUserId` in request body
- ✅ Default test users if not provided

## Next Steps

See [TESTING.md](./TESTING.md) for detailed testing scenarios.

