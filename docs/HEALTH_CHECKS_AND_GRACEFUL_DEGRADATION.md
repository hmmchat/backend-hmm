# Health Checks and Graceful Degradation

## Overview

All services implement comprehensive health checks and graceful degradation to ensure system resilience and prevent cascading failures.

## Health Check Endpoints

Every service exposes a `/health` endpoint that returns detailed health status:

```bash
GET /health
```

### Response Format

```json
{
  "status": "healthy" | "degraded" | "unhealthy",
  "timestamp": "2026-01-22T12:00:00.000Z",
  "service": "user-service",
  "version": "1.0.0",
  "checks": {
    "database": {
      "status": "up" | "down",
      "message": "Database connection successful",
      "responseTime": 5
    },
    "redis": {
      "status": "up" | "down",
      "message": "Redis connection successful",
      "responseTime": 2
    }
  },
  "dependencies": {
    "moderation-service": {
      "status": "up" | "down",
      "url": "http://moderation-service:3003",
      "responseTime": 10,
      "error": null
    }
  }
}
```

### Health Status Levels

- **healthy**: All critical checks pass, all dependencies available
- **degraded**: Critical checks pass, but some optional dependencies unavailable
- **unhealthy**: Critical checks fail (e.g., database down)

## Service Health Checks

### Auth Service
- **Critical**: Database
- **Optional**: None

### User Service
- **Critical**: Database
- **Optional**: Moderation Service, Wallet Service

### Discovery Service
- **Critical**: Database
- **Optional**: Redis, User Service, Friend Service, Wallet Service

### Wallet Service
- **Critical**: Database
- **Optional**: None

### Payment Service
- **Critical**: Database
- **Optional**: Wallet Service

### Friend Service
- **Critical**: Database
- **Optional**: Redis, User Service, Wallet Service, Streaming Service

### Files Service
- **Critical**: Database
- **Optional**: Cloudflare R2 (reported in health check)

### Streaming Service
- **Critical**: Database
- **Optional**: User Service, Discovery Service, Wallet Service, Friend Service

### Moderation Service
- **Critical**: Database
- **Optional**: None

## Graceful Degradation

### Circuit Breaker Pattern

Services use a circuit breaker pattern to prevent cascading failures:

```typescript
import { ServiceClient } from "@hmm/common";

const client = new ServiceClient({
  serviceName: "user-service",
  baseUrl: "http://user-service:3002",
  timeout: 5000,
  retries: 2,
  circuitBreakerThreshold: 5, // Open after 5 failures
  circuitBreakerTimeout: 60000, // Try again after 1 minute
  fallback: async () => {
    // Return cached data or default values
    return { users: [] };
  }
});
```

### Circuit Breaker States

1. **Closed**: Normal operation, requests pass through
2. **Open**: Too many failures, requests fail fast with fallback
3. **Half-Open**: Testing if service recovered, allows limited requests

### Retry Logic

- **Exponential Backoff**: Retries with increasing delays (1s, 2s, 4s, max 10s)
- **Configurable Retries**: Default 2 retries, configurable per service
- **Timeout Protection**: Requests timeout after configured duration (default 5s)

### Fallback Strategies

Services implement fallbacks for optional dependencies:

1. **Return Empty Data**: Return empty arrays/objects when optional service unavailable
2. **Use Cached Data**: Return cached data if available
3. **Skip Feature**: Disable feature that requires unavailable service
4. **Default Values**: Use sensible defaults

### Example: Graceful Degradation in Discovery Service

```typescript
// User service unavailable - use cached users or return empty
try {
  users = await this.userClient.getUsersForDiscovery(token, filters);
} catch (error) {
  this.logger.warn('User service unavailable, using fallback');
  users = await this.getCachedUsers(filters) || [];
}
```

## Service Discovery

### Environment Variables (Default)

Services discover each other via environment variables:

```bash
USER_SERVICE_URL=http://user-service:3002
WALLET_SERVICE_URL=http://wallet-service:3005
# etc.
```

### Kubernetes Service Discovery

When running in Kubernetes, services automatically use Kubernetes DNS:

```
http://user-service.default.svc.cluster.local:80
```

Detection: If `KUBERNETES_SERVICE_HOST` is set, uses K8s service discovery.

### Service Registry (Future)

Support for service registries (Consul, etcd) can be added by setting:

```bash
SERVICE_REGISTRY_URL=http://consul:8500
```

## Implementation

### Using ServiceClient

```typescript
import { ServiceClient, ServiceDiscovery } from "@hmm/common";

const discovery = ServiceDiscovery.getInstance();
const userServiceUrl = discovery.getServiceUrl("user-service");

const client = new ServiceClient({
  serviceName: "user-service",
  baseUrl: userServiceUrl,
  timeout: 5000,
  retries: 2,
  fallback: async () => ({ users: [] })
});

// Make request with automatic retry and circuit breaker
const users = await client.request<User[]>("/users");
```

### Health Check Implementation

```typescript
import { HealthChecker, HealthCheckResult } from "@hmm/common";

@Get("health")
async healthCheck(): Promise<HealthCheckResult> {
  const dbCheck = await HealthChecker.checkDatabase(this.prisma, "service-name");
  
  return HealthChecker.createResponse(
    "service-name",
    { database: dbCheck },
    dependencies,
    version
  );
}
```

## Monitoring

### Health Check Monitoring

Monitor health endpoints:
- **Frequency**: Every 30 seconds
- **Alert on**: `status === "unhealthy"`
- **Warning on**: `status === "degraded"`

### Circuit Breaker Monitoring

Track circuit breaker state:
- **Metrics**: Open/closed transitions, failure rates
- **Alerts**: Circuit breaker open for extended period
- **Logs**: All state transitions

## Best Practices

1. **Always Implement Fallbacks**: Never let optional dependencies break core functionality
2. **Set Appropriate Timeouts**: Balance between responsiveness and reliability
3. **Monitor Health Endpoints**: Set up alerts for unhealthy services
4. **Use Circuit Breakers**: Prevent cascading failures
5. **Log Degradations**: Track when services fall back to degraded mode
6. **Test Failure Scenarios**: Verify graceful degradation works

## Testing

### Test Health Endpoints

```bash
# Check service health
curl http://localhost:3002/health

# Check all services via API Gateway
curl http://localhost:3000/health
```

### Test Graceful Degradation

1. Stop a dependency service
2. Verify dependent service continues operating (degraded mode)
3. Check health endpoint shows `"status": "degraded"`
4. Restart dependency service
5. Verify service returns to `"status": "healthy"`

## Configuration

### Environment Variables

```bash
# Service URLs (required in production)
USER_SERVICE_URL=http://user-service:3002
WALLET_SERVICE_URL=http://wallet-service:3005

# Circuit Breaker Configuration
CIRCUIT_BREAKER_THRESHOLD=5
CIRCUIT_BREAKER_TIMEOUT=60000

# Retry Configuration
REQUEST_TIMEOUT_MS=5000
MAX_RETRIES=2

# Kubernetes (auto-detected)
KUBERNETES_SERVICE_HOST=10.0.0.1
KUBERNETES_NAMESPACE=default
```

## Summary

✅ **Health Checks**: All services have `/health` endpoints  
✅ **Graceful Degradation**: Services handle dependency failures gracefully  
✅ **Circuit Breaker**: Prevents cascading failures  
✅ **Service Discovery**: Automatic detection of deployment environment  
✅ **Retry Logic**: Automatic retries with exponential backoff  
✅ **Fallbacks**: Services continue operating with reduced functionality  
