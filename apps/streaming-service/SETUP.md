# Streaming Service Setup Guide

## Quick Setup for Testing

### 1. Create `.env` file

The `.env` file has been created with default values. If you need to modify it:

```bash
cd apps/streaming-service
# Edit .env file with your database credentials if different
```

Default DATABASE_URL: `postgresql://postgres:password@localhost:5432/hmm_streaming`

### 2. Ensure PostgreSQL is Running

```bash
# Check if PostgreSQL is running
pg_isready

# If not running, start it (method depends on your system)
# macOS with Homebrew:
brew services start postgresql@14

# Linux:
sudo systemctl start postgresql
```

### 3. Create Database (if needed)

The database will be created automatically when you run Prisma migrations, but you can also create it manually:

```bash
# Connect to PostgreSQL
psql -U postgres

# Create database
CREATE DATABASE hmm_streaming;

# Exit
\q
```

### 4. Setup Database Schema

```bash
cd apps/streaming-service

# Generate Prisma client
npm run prisma:generate

# Push schema to database (creates tables)
npm run prisma:push
```

### 5. Start the Service

```bash
# Start in TEST_MODE (no authentication required)
TEST_MODE=true npm run start:dev
```

You should see:
```
⚠️  TEST MODE ENABLED - Authentication is bypassed
🚀 Application is running on: http://localhost:3005
```

## Troubleshooting

### Error: "Environment variable not found: DATABASE_URL"

✅ **Fixed**: The `.env` file has been created. Make sure:
- `.env` file exists in `apps/streaming-service/`
- DATABASE_URL is set correctly
- Restart the service

### Error: "Database connection failed"

1. Check PostgreSQL is running: `pg_isready`
2. Verify credentials in `.env` match your PostgreSQL setup
3. Check database exists: `psql -U postgres -l | grep hmm_streaming`

### Error: "Database does not exist"

Run:
```bash
cd apps/streaming-service
npm run prisma:push
```

This will create the database and tables automatically.

### Error: "Prisma schema not pushed"

Run:
```bash
cd apps/streaming-service
npx prisma db push --accept-data-loss
```

## Testing

Once the service is running:

1. **Interactive Testing**: Open `tests/streaming-service/interactive-test.html` in browser
2. **Automated Testing**: Run `tests/streaming-service/test-streaming-e2e.sh`

## Environment Variables

Key variables in `.env`:

- `DATABASE_URL` - PostgreSQL connection string (required)
- `PORT` - Server port (default: 3005)
- `TEST_MODE` - Set to `true` when running: `TEST_MODE=true npm run start:dev`
- `MEDIASOUP_WORKERS` - Number of Mediasoup workers (default: 4)

## Next Steps

1. ✅ Verify `.env` file exists
2. ✅ Start PostgreSQL (if not running)
3. ✅ Run `npm run prisma:push` to setup database
4. ✅ Start service: `TEST_MODE=true npm run start:dev`
5. ✅ Open interactive test tool: `tests/streaming-service/interactive-test.html`

