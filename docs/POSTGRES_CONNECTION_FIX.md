# PostgreSQL Connection Limit Fix

## Problem

When running all 9 services, you may hit PostgreSQL's `max_connections` limit, causing:
- Health checks to fail (can't connect to database)
- Services to appear as "NOT RESPONDING"
- Error: "sorry, too many clients already"

## Root Cause

Each service creates a PrismaClient with a connection pool. With 9 services, this can exceed PostgreSQL's default `max_connections` (usually 100).

## Quick Fix (Recommended)

Run this script to restart PostgreSQL and restart all services with connection limits:

```bash
./scripts/fix-postgres-and-restart-services.sh
```

This will:
1. Stop all services
2. Restart PostgreSQL (frees all connections)
3. Restart services with `connection_limit=5` per service (45 total connections)

## Manual Fix

If the script doesn't work, do this manually:

### Step 1: Stop All Services
```bash
./scripts/cleanup-orphaned-processes.sh
# Or manually:
pkill -f "npm.*start:dev"
for p in 3000 3001 3002 3003 3004 3005 3006 3007 3008 3009; do
  lsof -ti:$p 2>/dev/null | xargs kill -9 2>/dev/null || true
done
```

### Step 2: Restart PostgreSQL
```bash
brew services restart postgresql@16
# Or:
brew services restart postgresql
# Wait 5-10 seconds for it to start
```

### Step 3: Restart Services
```bash
ulimit -n 8192 && ./scripts/setup-and-start-services.sh
```

The setup script now automatically adds `connection_limit=5` to each service's DATABASE_URL.

## Permanent Fix: Increase PostgreSQL max_connections

For development, increase PostgreSQL's max_connections:

1. Find PostgreSQL config file:
   ```bash
   # macOS with Homebrew:
   /opt/homebrew/var/postgresql@16/postgresql.conf
   # Or:
   /usr/local/var/postgres/postgresql.conf
   ```

2. Edit `postgresql.conf`:
   ```
   max_connections = 200
   ```

3. Restart PostgreSQL:
   ```bash
   brew services restart postgresql@16
   ```

## Verify Fix

After restarting, check services:
```bash
./scripts/check-all-services-health.sh
```

All services should show as healthy.

## Prevention

The setup script now automatically adds `connection_limit=5` to DATABASE_URL when starting services. This limits each service to 5 connections:
- 9 services × 5 connections = 45 total
- Well under default PostgreSQL limit of 100

If you still hit the limit, increase PostgreSQL `max_connections` as shown above.
