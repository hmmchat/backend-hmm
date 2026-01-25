# Streaming Service Troubleshooting

## Issue: Script shows service as healthy but curl fails

### Quick Diagnostic

Run these commands to diagnose the issue:

```bash
# 1. Check if port 3006 is actually LISTENING
lsof -i :3006 | grep LISTEN

# 2. Check streaming-service process
ps aux | grep "streaming-service\|node.*3006" | grep -v grep

# 3. Check service logs for errors
tail -50 /tmp/streaming-service.log

# 4. Test connection with verbose output
curl -v http://localhost:3006/health

# 5. Check if service is binding correctly
netstat -an | grep 3006
```

### Common Issues

#### 1. Service Died After Health Check

**Symptom:** Script reports healthy, but service is not running

**Check:**
```bash
ps aux | grep streaming-service | grep -v grep
# If nothing shows, service died
```

**Fix:**
```bash
# Check logs for crash reason
tail -100 /tmp/streaming-service.log | grep -i error

# Restart service
cd apps/streaming-service
npm run start:dev
```

#### 2. Port Not Actually Listening

**Symptom:** Port shows as "in use" but not listening

**Check:**
```bash
lsof -i :3006
# Should show: *:3006 (LISTEN) or 0.0.0.0:3006 (LISTEN)
# If shows CLOSED or ESTABLISHED only, service isn't listening
```

**Fix:**
```bash
# Kill any process on port
lsof -ti :3006 | xargs kill -9 2>/dev/null

# Restart service
./scripts/setup-and-start-services.sh
```

#### 3. Service Still Starting

**Symptom:** Service is starting but not ready yet

**Check:**
```bash
# Check if process exists but service not ready
ps aux | grep streaming-service
tail -f /tmp/streaming-service.log
# Look for "Streaming service running" message
```

**Fix:**
```bash
# Wait a bit and try again
sleep 5
curl http://localhost:3006/health
```

#### 4. Database Connection Issue

**Symptom:** Service starts but crashes on database connection

**Check:**
```bash
tail -50 /tmp/streaming-service.log | grep -i "database\|prisma\|connection"
```

**Fix:**
```bash
# Ensure DATABASE_URL is set
cd apps/streaming-service
cat .env | grep DATABASE_URL

# If missing, set it:
echo "DATABASE_URL=postgresql://postgres:postgres@localhost:5432/streaming-service?schema=public" >> .env
```

### Manual Health Check Commands

```bash
# Basic check
curl http://localhost:3006/health

# With timeout
curl --max-time 5 http://localhost:3006/health

# Verbose (shows connection details)
curl -v http://localhost:3006/health

# With JSON formatting (requires jq)
curl -s http://localhost:3006/health | jq '.'

# Check specific fields
curl -s http://localhost:3006/health | jq '{service, status, checks, dependencies}'
```

### Expected Health Response

```json
{
  "status": "healthy" | "degraded" | "unhealthy",
  "timestamp": "2026-01-24T...",
  "service": "streaming-service",
  "version": "0.0.1",
  "checks": {
    "database": {
      "status": "up",
      "message": "Database connection successful",
      "responseTime": 0
    }
  },
  "dependencies": {
    "user-service": { "status": "up" | "down", ... },
    "discovery-service": { "status": "up" | "down", ... },
    "wallet-service": { "status": "up" | "down", ... },
    "friend-service": { "status": "up" | "down", ... }
  }
}
```

### Restart Streaming Service

```bash
# Option 1: Via setup script
./scripts/setup-and-start-services.sh

# Option 2: Manual restart
lsof -ti :3006 | xargs kill -9 2>/dev/null
cd apps/streaming-service
npm run start:dev

# Option 3: Check and restart if needed
if ! curl -s http://localhost:3006/health >/dev/null 2>&1; then
  echo "Service not responding, restarting..."
  lsof -ti :3006 | xargs kill -9 2>/dev/null
  cd apps/streaming-service
  nohup npm run start:dev > /tmp/streaming-service.log 2>&1 &
fi
```
