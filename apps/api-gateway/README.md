# API Gateway

Central API Gateway service for hmmchat.live. Provides a single entry point for frontend requests, handles routing, authentication, rate limiting, and request aggregation.

## Features

- **Request Routing**: Routes requests to appropriate backend services
- **Authentication**: JWT token validation for protected endpoints
- **Rate Limiting**: Redis-based rate limiting per user/IP
- **Request Aggregation**: Homepage endpoint aggregates data from multiple services
- **Health Checks**: Aggregated health status of all services
- **Request Logging**: Correlation IDs for request tracing
- **CORS**: Configured for frontend origins

## Setup

### Prerequisites

- Node.js v22+
- Redis (for rate limiting, optional)

### Installation

```bash
cd apps/api-gateway
npm install
```

### Environment Variables

Create a `.env` file:

```env
# Server
PORT=3000
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173,http://localhost:3001,https://app.hmmchat.live,https://dashboard.beam.place

# Backend Service URLs
AUTH_SERVICE_URL=http://localhost:3001
USER_SERVICE_URL=http://localhost:3002
MODERATION_SERVICE_URL=http://localhost:3003
DISCOVERY_SERVICE_URL=http://localhost:3004
STREAMING_SERVICE_URL=http://localhost:3006
WALLET_SERVICE_URL=http://localhost:3005
FRIEND_SERVICE_URL=http://localhost:3009
FILES_SERVICE_URL=http://localhost:3008
PAYMENT_SERVICE_URL=http://localhost:3007
ADS_SERVICE_URL=http://localhost:3010

# JWT Authentication (same as other services)
JWT_PUBLIC_JWK='{"kty":"RSA",...}'

# Redis (for rate limiting, optional)
REDIS_URL=redis://localhost:6379
RATE_LIMIT_ENABLED=true
```

### Running

```bash
# Development
npm run start:dev

# Production
npm run build
npm start
```

## API Endpoints

All endpoints are prefixed with `/v1/`:

### Health Check

**GET** `/health`

Get aggregated health status of all services.

**Response:**
```json
{
  "status": "healthy",
  "services": [
    {
      "name": "auth-service",
      "url": "http://localhost:3001",
      "status": "healthy",
      "responseTime": 15
    },
    ...
  ],
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Homepage Aggregation

**GET** `/v1/homepage`

Aggregates data from multiple services (coins, meeting count, profile completion).

**Headers:**
- `Authorization: Bearer {token}` (required)

**Response:**
```json
{
  "coins": 1000,
  "diamonds": 500,
  "meetingCount": 5,
  "profileCompletion": {
    "percentage": 75.5,
    "completed": 15,
    "total": 20
  }
}
```

### Proxied Endpoints

All other requests are proxied to appropriate services:

- `/v1/auth/*` → auth-service
- `/v1/users/*` → user-service
- `/v1/me/*` → user-service
- `/v1/discovery/*` → discovery-service
- `/v1/squad/*` → discovery-service
- `/v1/streaming/*` → streaming-service
- `/v1/wallet/*` → wallet-service
- `/v1/friends/*` → friend-service
- `/v1/files/*` → files-service
- `/v1/payments/*` → payment-service
- `/v1/brands`, `/v1/interests`, `/v1/values`, `/v1/music/*` → user-service

## Rate Limiting

Rate limiting is enabled by default (requires Redis).

**Default Limits:**
- `/auth/*`: 10 requests per minute
- `/files/upload`: 20 requests per hour
- `/payments/*`: 10 requests per hour
- Other endpoints: 100 requests per minute

**Rate Limit Headers:**
- `X-RateLimit-Remaining`: Number of requests remaining
- `X-RateLimit-Reset`: Timestamp when limit resets

**Response (429 Too Many Requests):**
```json
{
  "error": "Rate limit exceeded",
  "message": "Too many requests. Please try again later.",
  "resetAt": 1704067200000
}
```

## Authentication

Protected endpoints require JWT token in `Authorization` header:

```
Authorization: Bearer {accessToken}
```

**Public Endpoints:**
- `/v1/auth/*` - Authentication endpoints
- `/v1/health` - Health check
- `/v1/brands`, `/v1/interests`, `/v1/values` - Catalog endpoints
- `/v1/music/search` - Music search

**Protected Endpoints:**
- `/v1/me/*` - User profile endpoints
- `/v1/discovery/*` - Discovery endpoints
- `/v1/squad/*` - Squad endpoints
- `/v1/wallet/*` - Wallet endpoints
- `/v1/friends/*` - Friend endpoints
- `/v1/payments/*` - Payment endpoints
- `/v1/streaming/*` - Streaming endpoints
- `/v1/homepage` - Homepage aggregation

## Request Flow

```
Frontend Request
    ↓
API Gateway (port 3000)
    ↓
[Authentication Check] (if required)
    ↓
[Rate Limiting Check]
    ↓
[Route to Service]
    ↓
Backend Service (3001-3009)
    ↓
Response
    ↓
API Gateway
    ↓
Frontend
```

## Service-to-Service Communication

**Important:** Services still communicate directly with each other (bypassing gateway):

```
discovery-service → user-service (direct)
streaming-service → user-service (direct)
payment-service → wallet-service (direct)
```

Gateway is **only** for frontend requests.

## Configuration

### Service URLs

Configure service URLs via environment variables. In production, use service discovery or load balancer URLs:

```env
# Development
AUTH_SERVICE_URL=http://localhost:3001

# Production (example)
AUTH_SERVICE_URL=http://auth-service.internal:3001
# Or with load balancer
AUTH_SERVICE_URL=https://auth.hmmchat.live
```

### Rate Limiting

Disable rate limiting (not recommended for production):

```env
RATE_LIMIT_ENABLED=false
```

### CORS

Configure allowed origins:

```env
ALLOWED_ORIGINS=https://app.hmmchat.live,https://staging.hmmchat.live
```

## Error Handling

Gateway handles errors gracefully:

- **404 Not Found**: Route not found
- **401 Unauthorized**: Missing or invalid token
- **429 Too Many Requests**: Rate limit exceeded
- **502 Bad Gateway**: Backend service unavailable
- **504 Gateway Timeout**: Backend service timeout

## Request Tracing

All requests include correlation IDs:

- Header: `X-Correlation-Id`
- Used for request tracing across services
- Logged in gateway and can be forwarded to services

## Deployment

### Standalone Deployment

Gateway can be deployed independently:

```bash
# Build
npm run build

# Start
npm start
```

### Docker Deployment

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
CMD ["npm", "start"]
```

### Kubernetes Deployment

Gateway can be deployed as a separate service in Kubernetes, with service discovery for backend services.

## Monitoring

### Health Check

Monitor gateway health:

```bash
curl http://localhost:3000/health
```

### Metrics

Consider adding:
- Request count per endpoint
- Response times
- Error rates
- Rate limit hits

## Troubleshooting

### Service Not Found

**Error:** `No route found for: /v1/some-path`

**Solution:** Check route configuration in `routing.service.ts` or add new route.

### Rate Limit Issues

**Error:** `Rate limit exceeded`

**Solution:** 
- Check Redis connection
- Adjust rate limits in `rate-limit.service.ts`
- Disable rate limiting for testing: `RATE_LIMIT_ENABLED=false`

### Authentication Failures

**Error:** `Invalid or expired token`

**Solution:**
- Verify `JWT_PUBLIC_JWK` is set correctly
- Check token is valid
- Ensure token hasn't expired

### Service Unavailable

**Error:** `Service unavailable`

**Solution:**
- Check backend service is running
- Verify service URL is correct
- Check network connectivity

## Architecture Notes

- **Stateless**: Gateway is stateless, can be scaled horizontally
- **No Database**: Gateway doesn't need a database
- **Optional**: Services work independently, gateway is optional
- **Frontend Only**: Gateway only handles frontend requests, not service-to-service

## Future Enhancements

- [ ] Request/response caching
- [ ] API versioning (v1, v2, etc.)
- [ ] Request transformation
- [ ] WebSocket proxying
- [ ] Metrics collection (Prometheus)
- [ ] Distributed tracing (OpenTelemetry)
