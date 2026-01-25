# Deployment Guide

This guide covers deploying services independently and together.

## Overview

Each service can be deployed independently. Services communicate via HTTP APIs using environment variables for service URLs.

## Prerequisites

- Docker and Docker Compose (for local/testing)
- Node.js 22+ (for local development)
- PostgreSQL database(s)
- Redis (for services that use it)
- Environment variables configured

## Independent Service Deployment

### Building a Single Service

Each service has its own Dockerfile. Build from the repository root:

```bash
# Build auth-service
docker build -f apps/auth-service/Dockerfile -t hmm/auth-service:latest .

# Build user-service
docker build -f apps/user-service/Dockerfile -t hmm/user-service:latest .

# Build any other service similarly
docker build -f apps/<service-name>/Dockerfile -t hmm/<service-name>:latest .
```

### Running a Single Service

```bash
docker run -d \
  --name auth-service \
  -p 3001:3001 \
  -e DATABASE_URL="postgresql://user:pass@host:5432/auth-service?schema=public" \
  -e PORT=3001 \
  -e REDIS_URL="redis://host:6379" \
  hmm/auth-service:latest
```

### Required Environment Variables

Each service needs:

#### Common Variables
- `NODE_ENV=production`
- `PORT` - Service port (see PORT_CONFIGURATION.md)
- `DATABASE_URL` - PostgreSQL connection string

#### Service-Specific Variables

**auth-service:**
- `JWT_PRIVATE_KEY` - JWT signing key
- `JWT_PUBLIC_JWK` - JWT public key
- `REDIS_URL` - Redis connection (optional)

**user-service:**
- `MODERATION_SERVICE_URL` - Moderation service URL
- `WALLET_SERVICE_URL` - Wallet service URL

**discovery-service:**
- `USER_SERVICE_URL` - User service URL
- `FRIEND_SERVICE_URL` - Friend service URL
- `STREAMING_SERVICE_URL` - Streaming service URL
- `WALLET_SERVICE_URL` - Wallet service URL
- `REDIS_URL` - Redis connection

**wallet-service:**
- (No additional required)

**payment-service:**
- `WALLET_SERVICE_URL` - Wallet service URL
- `RAZORPAY_KEY_ID` - Razorpay API key
- `RAZORPAY_KEY_SECRET` - Razorpay API secret
- `PAYMENT_ENCRYPTION_KEY` - Encryption key for bank details

**friend-service:**
- `USER_SERVICE_URL` - User service URL
- `WALLET_SERVICE_URL` - Wallet service URL
- `STREAMING_SERVICE_URL` - Streaming service URL
- `REDIS_URL` - Redis connection

**files-service:**
- `R2_ACCOUNT_ID` - Cloudflare R2 account ID
- `R2_ACCESS_KEY_ID` - R2 access key
- `R2_SECRET_ACCESS_KEY` - R2 secret key
- `R2_BUCKET_NAME` - R2 bucket name
- `R2_ENDPOINT` - R2 endpoint URL

**streaming-service:**
- `USER_SERVICE_URL` - User service URL
- `DISCOVERY_SERVICE_URL` - Discovery service URL
- `FRIEND_SERVICE_URL` - Friend service URL
- `WALLET_SERVICE_URL` - Wallet service URL
- `MEDIASOUP_ANNOUNCED_IP` - Public IP for WebRTC

**moderation-service:**
- (No additional required)

**api-gateway:**
- `AUTH_SERVICE_URL` - Auth service URL
- `USER_SERVICE_URL` - User service URL
- `MODERATION_SERVICE_URL` - Moderation service URL
- `DISCOVERY_SERVICE_URL` - Discovery service URL
- `STREAMING_SERVICE_URL` - Streaming service URL
- `WALLET_SERVICE_URL` - Wallet service URL
- `PAYMENT_SERVICE_URL` - Payment service URL
- `FILES_SERVICE_URL` - Files service URL
- `FRIEND_SERVICE_URL` - Friend service URL
- `JWT_PUBLIC_JWK` - JWT public key for validation

## Deployment with Docker Compose

For local development or testing all services together:

```bash
# Start all services
docker-compose up -d

# Start specific services
docker-compose up -d postgres redis auth-service user-service

# View logs
docker-compose logs -f auth-service

# Stop all services
docker-compose down

# Stop and remove volumes
docker-compose down -v
```

## Database Migrations

Before deploying a service, run migrations:

```bash
# Option 1: Run migrations in the container before starting
docker run --rm \
  -e DATABASE_URL="postgresql://user:pass@host:5432/db?schema=public" \
  hmm/auth-service:latest \
  npx prisma migrate deploy

# Option 2: Run migrations as part of deployment script
# See individual service READMEs for migration commands
```

## Service Dependencies

Services can be deployed in any order, but consider dependencies:

1. **Core Services** (can deploy first):
   - auth-service
   - user-service
   - wallet-service
   - moderation-service
   - files-service

2. **Dependent Services** (require core services):
   - discovery-service (needs: user-service, wallet-service)
   - friend-service (needs: user-service, wallet-service)
   - payment-service (needs: wallet-service)
   - streaming-service (needs: user-service, discovery-service)

3. **Gateway** (deploy last):
   - api-gateway (needs: all services)

## Health Checks

All services include health check endpoints:

```bash
# Check service health
curl http://localhost:3001/health  # auth-service
curl http://localhost:3002/health  # user-service
# etc.
```

Docker health checks are configured in each Dockerfile.

## Production Deployment

### 1. Build Images

```bash
# Build all services
for service in auth-service user-service discovery-service wallet-service payment-service friend-service files-service streaming-service moderation-service api-gateway; do
  docker build -f apps/$service/Dockerfile -t hmm/$service:latest .
done
```

### 2. Push to Registry

```bash
# Tag and push
docker tag hmm/auth-service:latest registry.example.com/hmm/auth-service:latest
docker push registry.example.com/hmm/auth-service:latest
```

### 3. Deploy to Production

Use your orchestration platform (Kubernetes, Docker Swarm, etc.):

**Kubernetes Example:**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: auth-service
spec:
  replicas: 2
  selector:
    matchLabels:
      app: auth-service
  template:
    metadata:
      labels:
        app: auth-service
    spec:
      containers:
      - name: auth-service
        image: registry.example.com/hmm/auth-service:latest
        ports:
        - containerPort: 3001
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: auth-secrets
              key: database-url
        - name: PORT
          value: "3001"
```

## CI/CD Integration

The `.github/workflows/deploy.yml` workflow automatically:
- Detects changed services
- Builds Docker images
- Pushes to container registry
- Can trigger deployments

**Manual deployment:**
```bash
# Deploy specific service via GitHub Actions
gh workflow run deploy.yml -f service=auth-service
```

## Monitoring and Logs

```bash
# View service logs
docker logs -f auth-service

# View logs from docker-compose
docker-compose logs -f auth-service

# Check service status
docker ps | grep hmm
```

## Troubleshooting

### Service Won't Start

1. Check environment variables are set correctly
2. Verify database is accessible
3. Check service dependencies are running
4. Review logs: `docker logs <service-name>`

### Database Connection Issues

- Verify `DATABASE_URL` format: `postgresql://user:pass@host:port/db?schema=public`
- Ensure database exists
- Check network connectivity
- Verify credentials

### Service Communication Issues

- Verify service URLs in environment variables
- Check services are accessible from each other
- Review network configuration (Docker network, firewall, etc.)
- Test with `curl` from within containers

## Best Practices

1. **Use Environment Variables**: Never hardcode URLs or secrets
2. **Health Checks**: Monitor service health endpoints
3. **Graceful Shutdown**: Services handle SIGTERM for clean shutdown
4. **Database Migrations**: Run migrations before deploying new versions
5. **Rolling Updates**: Deploy services one at a time to avoid downtime
6. **Resource Limits**: Set appropriate CPU/memory limits in production
7. **Secrets Management**: Use secret management (Kubernetes secrets, AWS Secrets Manager, etc.)

## Service URLs Reference

See `docs/PORT_CONFIGURATION.md` for canonical port assignments.

Default service URLs (override with environment variables):
- Auth: `http://localhost:3001`
- User: `http://localhost:3002`
- Moderation: `http://localhost:3003`
- Discovery: `http://localhost:3004`
- Streaming: `http://localhost:3006`
- Wallet: `http://localhost:3005`
- Payment: `http://localhost:3007`
- Files: `http://localhost:3008`
- Friend: `http://localhost:3009`
- API Gateway: `http://localhost:3000`

## Additional Resources

- Individual service READMEs in `apps/<service>/README.md`
- Port configuration: `docs/PORT_CONFIGURATION.md`
- Database isolation: `docs/DATABASE_ISOLATION.md`
