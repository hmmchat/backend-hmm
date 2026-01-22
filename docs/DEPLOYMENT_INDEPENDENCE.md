# Deployment Independence

## Overview

All services are designed to be deployed **independently** without requiring other services to be running. This document explains how deployment independence is achieved.

## Key Principles

1. **No Build-Time Dependencies**: Services don't require other services to build
2. **Runtime Configuration**: Service URLs configured via environment variables
3. **Graceful Degradation**: Services handle missing dependencies gracefully
4. **Health Checks**: Each service has independent health endpoints
5. **Database Isolation**: Services use separate databases or shared database with proper isolation

## How It Works

### 1. Service Discovery via Environment Variables

Services discover each other through environment variables, not hardcoded URLs:

```typescript
// ✅ Good: Uses environment variable with fallback
const userServiceUrl = process.env.USER_SERVICE_URL || "http://localhost:3002";

// ❌ Bad: Hardcoded URL
const userServiceUrl = "http://user-service:3002";
```

### 2. Independent Docker Images

Each service has its own Dockerfile and can be built independently:

```bash
# Build only auth-service
docker build -f apps/auth-service/Dockerfile -t auth-service:latest .

# No need to build other services
```

### 3. Optional Dependencies

Services handle missing dependencies gracefully:

```typescript
// Example: Friend service can work without streaming service
try {
  await this.streamingClient.checkBroadcastStatus(userId);
} catch (error) {
  // Log warning but continue
  this.logger.warn('Streaming service unavailable, continuing without broadcast check');
}
```

### 4. Database Independence

- Each service has its own database OR
- Services share a database but with proper schema isolation (see `docs/DATABASE_ISOLATION.md`)
- Migrations run independently per service

## Deployment Scenarios

### Scenario 1: Deploy Single Service

Deploy only `user-service` without other services:

```bash
# Build
docker build -f apps/user-service/Dockerfile -t user-service:latest .

# Run
docker run -d \
  -e DATABASE_URL="postgresql://host/user-service" \
  -e PORT=3002 \
  user-service:latest
```

The service will start and be healthy even if `moderation-service` or `wallet-service` are unavailable.

### Scenario 2: Deploy Service Group

Deploy related services together (e.g., all discovery-related services):

```bash
# Deploy discovery ecosystem
docker-compose up -d discovery-service user-service wallet-service
```

### Scenario 3: Rolling Updates

Update services one at a time:

```bash
# 1. Deploy new version of auth-service
docker-compose up -d --no-deps auth-service

# 2. Wait for health check
curl http://localhost:3001/health

# 3. Deploy next service
docker-compose up -d --no-deps user-service
```

## Service Dependencies

### Required Dependencies (Service won't function without these)

- **discovery-service** → `USER_SERVICE_URL` (required for user lookups)
- **payment-service** → `WALLET_SERVICE_URL` (required for transactions)
- **api-gateway** → All service URLs (required for routing)

### Optional Dependencies (Service works but with reduced functionality)

- **friend-service** → `STREAMING_SERVICE_URL` (optional: broadcast status checks)
- **discovery-service** → `FRIEND_SERVICE_URL` (optional: friend-based filtering)
- **user-service** → `MODERATION_SERVICE_URL` (optional: image moderation)

## Environment Variable Fallbacks

All services use localhost fallbacks for local development:

```typescript
// Pattern used across all services
const serviceUrl = process.env.SERVICE_URL || "http://localhost:PORT";
```

**For Production**: Always set environment variables explicitly. Never rely on localhost fallbacks.

## Health Check Independence

Each service has its own health endpoint that doesn't depend on other services:

```bash
# Health check only checks the service itself
GET /health → 200 OK

# Aggregate health (optional) checks dependencies
GET /health/detailed → Includes dependency status
```

## CI/CD Independence

The GitHub Actions workflow (`.github/workflows/deploy.yml`) supports:

1. **Detecting changed services**: Only builds/deploys changed services
2. **Manual service selection**: Deploy specific service via workflow_dispatch
3. **Parallel builds**: Build multiple services in parallel

## Testing Independence

Each service has independent test suites:

```bash
# Test only auth-service
cd apps/auth-service && npm test

# Test only user-service
cd apps/user-service && npm test
```

Tests mock external service dependencies.

## Benefits

1. **Faster Deployments**: Only deploy what changed
2. **Reduced Risk**: Smaller blast radius for failures
3. **Flexible Scaling**: Scale services independently
4. **Easier Debugging**: Isolate issues to specific services
5. **Team Autonomy**: Teams can deploy their services independently

## Limitations

1. **Runtime Dependencies**: Services still need other services at runtime for full functionality
2. **Database Migrations**: Some services share databases (see `docs/DATABASE_ISOLATION.md`)
3. **API Gateway**: Requires all services for complete routing

## Best Practices

1. **Always set environment variables** in production (never use localhost fallbacks)
2. **Use service discovery** (Kubernetes services, Docker networks, etc.) for service URLs
3. **Monitor dependencies**: Track which services depend on which
4. **Document dependencies**: Keep service READMEs updated with required/optional dependencies
5. **Test independently**: Ensure services can start without all dependencies

## Verification

To verify deployment independence:

```bash
# 1. Build service in isolation
docker build -f apps/auth-service/Dockerfile -t test-auth .

# 2. Run without dependencies
docker run --rm \
  -e DATABASE_URL="postgresql://host/db" \
  -e PORT=3001 \
  test-auth

# 3. Check health
curl http://localhost:3001/health
# Should return 200 even without other services
```

## Summary

✅ **Services can be built independently**  
✅ **Services can be deployed independently**  
✅ **Services can run independently** (with graceful degradation)  
✅ **Services can be tested independently**  
✅ **CI/CD supports independent deployments**  

⚠️ **Services may have reduced functionality without dependencies**  
⚠️ **Always configure environment variables in production**
