# Service Stability Fix

## Root Causes of Service Crashes

### 1. PostgreSQL Connection Issues
**Problem:** Services crash when PostgreSQL is not accessible
- Services try to connect to database on startup
- If connection fails, service crashes
- `pg_isready` check was failing even when PostgreSQL was running

**Fix:**
- Updated PostgreSQL check to use port listening as fallback
- Services now wait for database connection properly

### 2. Process Management Issues
**Problem:** Multiple setup script runs create orphaned processes
- 37 npm processes but only 9 node services
- Old processes aren't cleaned up
- Services get killed when script runs again

**Fix:**
- Improved process cleanup before starting
- Better `kill_port` function
- Track both npm and node PIDs
- Created cleanup script: `scripts/cleanup-orphaned-processes.sh`

### 3. Health Check Timeouts
**Problem:** Health checks are slow due to dependency checks
- Services check dependencies sequentially
- Each check has timeout (1-2 seconds)
- Total time can exceed curl timeout

**Fix:**
- Made dependency checks parallel (streaming-service)
- Reduced timeouts (2000ms → 1000ms)
- Increased API Gateway timeout (2s → 20s)

## Quick Fixes

### Clean Up Orphaned Processes
```bash
# Kill all npm processes
pkill -f "npm run start:dev"

# Or use cleanup script
./scripts/cleanup-orphaned-processes.sh
```

### Restart Services Properly
```bash
# Use setup script (now fixed)
./scripts/setup-and-start-services.sh

# Or start manually
cd apps/user-service
npm run start:dev
```

### Check Service Status
```bash
# Quick check
curl http://localhost:3002/health

# With timeout (health checks can be slow)
curl --max-time 10 http://localhost:3002/health
```

## Service Health Check Endpoints

| Service | Port | Endpoint | Timeout |
|---------|------|----------|---------|
| auth-service | 3001 | `/health` | 2s |
| user-service | 3002 | `/health` | 2s |
| streaming-service | 3006 | `/health` | 5s (checks dependencies) |
| payment-service | 3007 | `/v1/payments/health` | 5s |
| api-gateway | 3000 | `/health` | 20s (checks all services) |

## Prevention

1. **Don't run setup script multiple times** - Clean up first
2. **Use cleanup script** before restarting: `./scripts/cleanup-orphaned-processes.sh`
3. **Check PostgreSQL** is running before starting services
4. **Use longer timeouts** for health checks (10s) if services are slow
