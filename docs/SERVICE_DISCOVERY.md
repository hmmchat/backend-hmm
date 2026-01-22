# Service Discovery for Production

## Overview

Service discovery automatically resolves service URLs based on the deployment environment. This enables services to be deployed independently without hardcoded URLs.

## Supported Discovery Modes

### 1. Environment Variables (Default)

Services discover each other via environment variables:

```bash
USER_SERVICE_URL=http://user-service:3002
WALLET_SERVICE_URL=http://wallet-service:3006
FRIEND_SERVICE_URL=http://friend-service:3009
# etc.
```

**When used**: Local development, Docker Compose, or any environment where you set service URLs explicitly.

### 2. Kubernetes Service Discovery

Automatically uses Kubernetes DNS when running in Kubernetes:

```
http://user-service.default.svc.cluster.local:80
```

**Detection**: Automatically enabled when `KUBERNETES_SERVICE_HOST` environment variable is set.

**Configuration**:
```bash
KUBERNETES_SERVICE_HOST=10.0.0.1  # Auto-detected by Kubernetes
KUBERNETES_NAMESPACE=default       # Optional, defaults to "default"
```

**Service Ports**: Can be overridden per service:
```bash
USER_SERVICE_PORT=3002
WALLET_SERVICE_PORT=3006
```

### 3. Service Registry (Future)

Support for service registries like Consul, etcd:

```bash
SERVICE_REGISTRY_URL=http://consul:8500
```

**Status**: Framework ready, implementation pending.

## Usage

### In Service Code

```typescript
import { ServiceDiscovery } from "@hmm/common";

const discovery = ServiceDiscovery.getInstance();
const userServiceUrl = discovery.getServiceUrl("user-service");

// Use URL for service calls
const response = await fetch(`${userServiceUrl}/users`);
```

### With ServiceClient

```typescript
import { ServiceClient, ServiceDiscovery } from "@hmm/common";

const discovery = ServiceDiscovery.getInstance();
const userServiceUrl = discovery.getServiceUrl("user-service");

const client = new ServiceClient({
  serviceName: "user-service",
  baseUrl: userServiceUrl,
  // ... other config
});
```

## Service Name Mapping

Service names follow the pattern: `{service-name}-service`

| Service Name | Port | Default URL |
|--------------|------|-------------|
| `api-gateway` | 3000 | `http://localhost:3000` |
| `auth-service` | 3001 | `http://localhost:3001` |
| `user-service` | 3002 | `http://localhost:3002` |
| `moderation-service` | 3003 | `http://localhost:3003` |
| `discovery-service` | 3004 | `http://localhost:3004` |
| `streaming-service` | 3005 | `http://localhost:3005` |
| `wallet-service` | 3006 | `http://localhost:3006` |
| `payment-service` | 3007 | `http://localhost:3007` |
| `files-service` | 3008 | `http://localhost:3008` |
| `friend-service` | 3009 | `http://localhost:3009` |

## Environment-Specific Configuration

### Local Development

```bash
# .env file
USER_SERVICE_URL=http://localhost:3002
WALLET_SERVICE_URL=http://localhost:3006
```

### Docker Compose

```yaml
services:
  user-service:
    environment:
      - USER_SERVICE_URL=http://user-service:3002
```

### Kubernetes

```yaml
apiVersion: v1
kind: Service
metadata:
  name: user-service
spec:
  ports:
    - port: 3002
      targetPort: 3002
```

Service discovery automatically uses: `http://user-service.default.svc.cluster.local:3002`

### Production (Cloud)

Set environment variables per deployment:

```bash
# Via deployment config
USER_SERVICE_URL=https://user-service.internal.example.com
WALLET_SERVICE_URL=https://wallet-service.internal.example.com
```

## Health Check Integration

Service discovery updates health status:

```typescript
const discovery = ServiceDiscovery.getInstance();

// Check service health
const url = discovery.getServiceUrl("user-service");
const health = await HealthChecker.checkService(url);

// Update discovery with health status
discovery.updateHealth("user-service", health.status === "up");
```

## Best Practices

1. **Always use ServiceDiscovery**: Never hardcode service URLs
2. **Set Environment Variables**: Explicitly set service URLs in production
3. **Use Kubernetes DNS**: Let Kubernetes handle service discovery when possible
4. **Monitor Health**: Update service health status in discovery
5. **Fallback to Localhost**: Only for local development

## Migration Guide

### Before (Hardcoded)

```typescript
const userServiceUrl = "http://localhost:3002";
```

### After (Service Discovery)

```typescript
import { ServiceDiscovery } from "@hmm/common";

const discovery = ServiceDiscovery.getInstance();
const userServiceUrl = discovery.getServiceUrl("user-service");
```

## Troubleshooting

### Service Not Found

**Error**: `Service user-service not found in service discovery`

**Solution**: Ensure service name matches exactly (use `-service` suffix)

### Wrong URL in Kubernetes

**Issue**: Service discovery using wrong URL in Kubernetes

**Solution**: Check `KUBERNETES_NAMESPACE` matches your namespace, or set service port explicitly

### Environment Variable Not Used

**Issue**: Service discovery not using `USER_SERVICE_URL` environment variable

**Solution**: Ensure variable name format: `{SERVICE_NAME}_URL` (uppercase, underscores)

## Summary

✅ **Automatic Detection**: Detects Kubernetes vs. environment variables  
✅ **Fallback Support**: Falls back to localhost for local development  
✅ **Health Integration**: Tracks service health status  
✅ **Production Ready**: Works in all deployment environments  
