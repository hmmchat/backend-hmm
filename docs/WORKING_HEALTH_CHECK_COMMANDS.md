# Working Health Check Commands - Permanent Fix

## Quick Health Check Script

Run this to check all services:
```bash
./scripts/check-all-services-health.sh
```

## Individual Service Health Checks

### Tier 1: Services with No Dependencies (15s timeout)

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

### Tier 2: Services with Dependencies (25-30s timeout)

```bash
# User Service (depends on: moderation-service, wallet-service)
curl --max-time 30 http://localhost:3002/health

# Payment Service (depends on: wallet-service)
# NOTE: Payment service uses /v1/payments/health, not /health
curl --max-time 25 http://localhost:3007/v1/payments/health
```

### Tier 3: Services with Multiple Dependencies (30s timeout)

```bash
# Friend Service (depends on: user-service, wallet-service)
curl --max-time 30 http://localhost:3009/health

# Streaming Service (depends on: user-service, discovery-service, wallet-service, friend-service)
curl --max-time 30 http://localhost:3006/health
```

### Tier 4: API Gateway (35s timeout)

```bash
# API Gateway (depends on: ALL services)
curl --max-time 35 http://localhost:3000/health
```

## Why These Timeouts?

- **Tier 1 services**: Start quickly (5-10s), no dependencies
- **Tier 2 services**: Need to check dependencies (10-20s)
- **Tier 3 services**: Multiple dependency checks (15-30s)
- **API Gateway**: Checks all 9 services (20-35s)

## Permanent Fix Applied

The setup script (`scripts/setup-and-start-services.sh`) has been updated with:

1. **Dependency-aware startup order** (4 tiers)
2. **Progressive verification** between tiers
3. **Appropriate wait times** (3s, 5s, 8s + verification)
4. **Extended final wait** (30-45s total)
5. **Proper health check timeouts** (15-35s based on service)

## Service Status Meanings

- **healthy**: Service is fully operational
- **degraded**: Service is running but some dependencies are down
- **unhealthy**: Service has critical issues
- **NOT RESPONDING**: Service is not running or crashed

## Troubleshooting

If a service shows "NOT RESPONDING":

1. Check if it's running:
   ```bash
   lsof -i :<port> | grep LISTEN
   ```

2. Check logs:
   ```bash
   tail -f /tmp/<service-name>.log
   ```

3. Restart the service:
   ```bash
   ./scripts/setup-and-start-services.sh
   ```

## Complete Service List

| Service | Port | Endpoint | Timeout | Tier |
|---------|------|----------|---------|------|
| API Gateway | 3000 | `/health` | 35s | 4 |
| Auth Service | 3001 | `/health` | 15s | 1 |
| User Service | 3002 | `/health` | 30s | 2 |
| Moderation Service | 3003 | `/health` | 15s | 1 |
| Discovery Service | 3004 | `/health` | 15s | 1 |
| Wallet Service | 3005 | `/health` | 15s | 1 |
| Streaming Service | 3006 | `/health` | 30s | 3 |
| Payment Service | 3007 | `/v1/payments/health` | 25s | 2 |
| Files Service | 3008 | `/health` | 15s | 1 |
| Friend Service | 3009 | `/health` | 30s | 3 |
