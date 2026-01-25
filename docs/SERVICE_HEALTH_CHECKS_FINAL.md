# Service Health Check Commands - Final Working List

This document provides the definitive curl commands for checking the health status of all services.

## Important Notes

1. **Timeouts**: Services with dependency checks (user-service, streaming-service, api-gateway) may take 15-30 seconds to respond. Use appropriate timeouts.

2. **Service Startup Order**: Services must be started in dependency order:
   - Tier 1 (no dependencies): auth, moderation, wallet, files, discovery
   - Tier 2 (depend on Tier 1): user, payment
   - Tier 3 (depend on Tier 2): friend, streaming
   - Tier 4 (depends on all): api-gateway

3. **Wait Times**: After starting services, wait at least 30-45 seconds before checking health, especially for services with dependencies.

## Health Check Commands

### Tier 1: Services with No Dependencies

These services start quickly (5-10 seconds) and have no dependencies:

```bash
# Auth Service
curl --max-time 15 http://localhost:3001/health

# Moderation Service
curl --max-time 15 http://localhost:3003/health

# Wallet Service
curl --max-time 15 http://localhost:3005/health

# Files Service
curl --max-time 15 http://localhost:3008/health

# Discovery Service
curl --max-time 15 http://localhost:3004/health
```

### Tier 2: Services with Dependencies

These services depend on Tier 1 services and may take 10-20 seconds:

```bash
# User Service (depends on: moderation-service, wallet-service)
curl --max-time 25 http://localhost:3002/health

# Payment Service (depends on: wallet-service)
curl --max-time 25 http://localhost:3007/v1/payments/health
```

**Note**: Payment service uses `/v1/payments/health` endpoint, not `/health`.

### Tier 3: Services with Multiple Dependencies

These services depend on Tier 2 services and may take 15-30 seconds:

```bash
# Friend Service (depends on: user-service, wallet-service)
curl --max-time 30 http://localhost:3009/health

# Streaming Service (depends on: user-service, discovery-service, wallet-service, friend-service)
curl --max-time 30 http://localhost:3006/health
```

### Tier 4: API Gateway

The API Gateway depends on all services and checks their health, so it takes the longest:

```bash
# API Gateway (depends on: ALL services)
curl --max-time 35 http://localhost:3000/health
```

## Complete Health Check Script

Use the provided script to check all services at once:

```bash
./scripts/check-all-services-health.sh
```

Or run manually:

```bash
#!/bin/bash

# Service definitions: name:port:endpoint:timeout
services=(
    "api-gateway:3000:/health:35"
    "auth-service:3001:/health:15"
    "user-service:3002:/health:30"
    "moderation-service:3003:/health:15"
    "discovery-service:3004:/health:15"
    "wallet-service:3005:/health:15"
    "streaming-service:3006:/health:30"
    "payment-service:3007:/v1/payments/health:25"
    "files-service:3008:/health:15"
    "friend-service:3009:/health:30"
)

for service_config in "${services[@]}"; do
    IFS=':' read -r name port endpoint timeout <<< "$service_config"
    echo -n "Checking $name... "
    if curl -s --max-time $timeout "http://localhost:$port$endpoint" >/dev/null 2>&1; then
        echo "✓ healthy"
    else
        echo "✗ NOT RESPONDING"
    fi
done
```

## Troubleshooting

### Service Not Responding

1. **Check if service is running:**
   ```bash
   lsof -i :<port> | grep LISTEN
   ```

2. **Check service logs:**
   ```bash
   tail -f /tmp/<service-name>.log
   ```

3. **Verify service started correctly:**
   ```bash
   ps aux | grep "<service-name>"
   ```

### Common Issues

1. **ECONNREFUSED**: Service is not running or crashed
   - Check logs: `tail -f /tmp/<service-name>.log`
   - Restart service using setup script

2. **Timeout**: Service is starting but taking too long
   - Increase timeout: `curl --max-time 60 ...`
   - Check if dependencies are up
   - Check service logs for errors

3. **404 Not Found**: Wrong endpoint
   - Payment service uses `/v1/payments/health`, not `/health`
   - Verify endpoint in service documentation

4. **503 Service Unavailable**: Service is up but dependencies are down
   - Check dependency services
   - Wait longer for dependencies to be ready

## Service Ports Reference

| Service | Port | Health Endpoint | Startup Time |
|---------|------|----------------|--------------|
| API Gateway | 3000 | `/health` | 20-30s |
| Auth Service | 3001 | `/health` | 5-10s |
| User Service | 3002 | `/health` | 10-20s |
| Moderation Service | 3003 | `/health` | 5-10s |
| Discovery Service | 3004 | `/health` | 5-10s |
| Wallet Service | 3005 | `/health` | 5-10s |
| Streaming Service | 3006 | `/health` | 15-30s |
| Payment Service | 3007 | `/v1/payments/health` | 10-20s |
| Files Service | 3008 | `/health` | 5-10s |
| Friend Service | 3009 | `/health` | 15-30s |

## Starting Services

Use the setup script to start all services in the correct order:

```bash
./scripts/setup-and-start-services.sh
```

The script automatically:
1. Checks prerequisites (PostgreSQL, Redis)
2. Sets up Prisma migrations
3. Cleans up orphaned processes
4. Starts services in dependency order
5. Waits appropriate times between tiers
6. Verifies all services are healthy
