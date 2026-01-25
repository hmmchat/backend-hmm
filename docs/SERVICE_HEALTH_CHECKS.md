# Service Health Check Commands

Complete list of working `curl` commands to check the health status of all services.

## ⚠️ Important Notes

- **Always use `--max-time 15` or higher timeout** - Health checks can take 5-10 seconds due to dependency checks
- Services are working but may respond slowly
- If a service doesn't respond, wait a few seconds and try again
- **Payment Service uses a different endpoint:** `/v1/payments/health` instead of `/health`

## Health Check Commands

### API Gateway (Port 3000)
```bash
curl --max-time 15 http://localhost:3000/health
```

### Auth Service (Port 3001)
```bash
curl --max-time 15 http://localhost:3001/health
```

### User Service (Port 3002)
```bash
curl --max-time 15 http://localhost:3002/health
```

### Moderation Service (Port 3003)
```bash
curl --max-time 15 http://localhost:3003/health
```

### Discovery Service (Port 3004)
```bash
curl --max-time 15 http://localhost:3004/health
```

### Wallet Service (Port 3005)
```bash
curl --max-time 15 http://localhost:3005/health
```

### Streaming Service (Port 3006)
```bash
curl --max-time 15 http://localhost:3006/health
```

### Payment Service (Port 3007)
**Note:** Payment service uses a different health endpoint path.
```bash
curl --max-time 15 http://localhost:3007/v1/payments/health
```

### Files Service (Port 3008)
```bash
curl --max-time 15 http://localhost:3008/health
```

### Friend Service (Port 3009)
```bash
curl --max-time 15 http://localhost:3009/health
```

## Quick Check All Services

Run this command to check all services at once:

```bash
for service in "api-gateway:3000:/health" "auth-service:3001:/health" "user-service:3002:/health" "moderation-service:3003:/health" "discovery-service:3004:/health" "wallet-service:3005:/health" "streaming-service:3006:/health" "payment-service:3007:/v1/payments/health" "files-service:3008:/health" "friend-service:3009:/health"; do
  IFS=':' read -r name port endpoint <<< "$service"
  echo -n "$name: "
  if curl -s --max-time 15 "http://localhost:$port$endpoint" >/dev/null 2>&1; then
    echo "✓ HEALTHY"
  else
    echo "✗ NOT RESPONDING"
  fi
done
```

## Pretty Print with jq

To get formatted JSON output with service name and status:

```bash
# Auth Service
curl -s --max-time 15 http://localhost:3001/health | jq '{service, status}'

# User Service
curl -s --max-time 15 http://localhost:3002/health | jq '{service, status}'

# Streaming Service
curl -s --max-time 15 http://localhost:3006/health | jq '{service, status}'
```

## Expected Response Format

Most services return JSON in this format:

```json
{
  "service": "user-service",
  "status": "healthy",
  "timestamp": "2026-01-24T18:51:28.651Z",
  "version": "1.0.0",
  "checks": {
    "database": {
      "status": "up",
      "message": "Database connection successful",
      "responseTime": 5
    }
  }
}
```

## Troubleshooting

### Service Not Responding

1. **Check if service is listening:**
   ```bash
   lsof -i :3002  # Replace 3002 with service port
   ```

2. **Check service logs:**
   ```bash
   tail -f /tmp/user-service.log  # Replace with service name
   ```

3. **Increase timeout:**
   ```bash
   curl --max-time 30 http://localhost:3002/health
   ```

4. **Restart service:**
   ```bash
   ./scripts/setup-and-start-services.sh
   ```

### Slow Response Times

- Health checks include dependency checks (database, other services)
- This is normal and expected
- Always use `--max-time 15` or higher
- Services are working, just be patient

## Service Ports Reference

| Service | Port | Health Endpoint |
|---------|------|-----------------|
| API Gateway | 3000 | `/health` |
| Auth Service | 3001 | `/health` |
| User Service | 3002 | `/health` |
| Moderation Service | 3003 | `/health` |
| Discovery Service | 3004 | `/health` |
| Wallet Service | 3005 | `/health` |
| Streaming Service | 3006 | `/health` |
| Payment Service | 3007 | `/v1/payments/health` |
| Files Service | 3008 | `/health` |
| Friend Service | 3009 | `/health` |
