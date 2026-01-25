# Service Startup Order

This document describes the dependency-aware startup order implemented in `setup-and-start-services.sh`.

## Startup Tiers

Services are started in tiers based on their dependencies:

### Tier 1: No Dependencies (Start First)
These services have no dependencies on other services and can start immediately:

- **auth-service** (Port 3001)
- **moderation-service** (Port 3003)
- **wallet-service** (Port 3005)
- **files-service** (Port 3008)
- **discovery-service** (Port 3004)

### Tier 2: Depend on Tier 1
These services depend on Tier 1 services:

- **user-service** (Port 3002)
  - Depends on: moderation-service, wallet-service
- **payment-service** (Port 3007)
  - Depends on: wallet-service

**Wait:** 3 seconds after Tier 1 completes

### Tier 3: Depend on Tier 2
These services depend on Tier 2 services:

- **friend-service** (Port 3009)
  - Depends on: user-service, wallet-service
- **streaming-service** (Port 3006)
  - Depends on: user-service, discovery-service, wallet-service, friend-service

**Wait:** 5 seconds after Tier 2 completes (streaming-service has many dependencies)

### Tier 4: Depends on All Services
This service depends on all other services:

- **api-gateway** (Port 3000)
  - Depends on: ALL services (checks health of all 9 services)

**Wait:** Services start after Tier 3 completes

## Cleanup Before Startup

The script now includes a cleanup phase that:
1. Kills all orphaned `npm run start:dev` processes
2. Clears all service ports (3000-3009) by killing node processes
3. Ensures a clean slate before starting services

## Health Check Timeouts

Health checks use appropriate timeouts based on service complexity:

- **Standard services:** 10-15 seconds
- **Services with dependency checks (user, streaming):** 15-25 seconds
- **API Gateway:** 25-30 seconds (checks all 9 services)

## Verification

After all services start, the script waits 20 seconds for services to fully initialize, then verifies all services with appropriate timeouts.
