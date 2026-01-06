# Quick Start - Streaming Service

## ✅ Fixed: DATABASE_URL Error

The `.env` file has been created with the correct `DATABASE_URL`.

## Start the Service Now

```bash
cd apps/streaming-service
TEST_MODE=true npm run start:dev
```

You should now see:
```
⚠️  TEST MODE ENABLED - Authentication is bypassed
🚀 Application is running on: http://localhost:3005
WebSocket gateway initialized at /streaming/ws
```

## Verify It's Working

1. **Test REST API**:
```bash
curl http://localhost:3005/streaming/rooms/test
```

2. **Test WebSocket**:
   - Open `tests/streaming-service/interactive-test.html` in browser
   - Click "Test Connection" button
   - Should show "Connected" status

## What Was Fixed

- ✅ Created `.env` file with `DATABASE_URL=postgresql://postgres:password@localhost:5432/hmm_streaming`
- ✅ Verified PostgreSQL is running
- ✅ Verified database `hmm_streaming` exists
- ✅ Database schema is up to date

## If You Still See Errors

### Change Database Credentials

If your PostgreSQL uses different credentials, edit `.env`:

```bash
# Edit the .env file
nano apps/streaming-service/.env

# Update DATABASE_URL to match your setup:
# DATABASE_URL=postgresql://YOUR_USER:YOUR_PASSWORD@localhost:5432/hmm_streaming
```

### Database Doesn't Exist

If the database doesn't exist, Prisma will create it automatically when you start the service, or create it manually:

```bash
psql -U postgres
CREATE DATABASE hmm_streaming;
\q
```

Then run:
```bash
cd apps/streaming-service
npm run prisma:push
```

## Next Steps

1. ✅ Start service: `TEST_MODE=true npm run start:dev`
2. ✅ Open test tool: `tests/streaming-service/interactive-test.html`
3. ✅ Follow test cases: `tests/streaming-service/INTERACTIVE_TEST_GUIDE.md`

---

**Ready to test!** 🚀

