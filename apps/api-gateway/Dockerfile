# Multi-stage build for api-gateway
FROM node:22-alpine AS base
# Python + build-base + linux-headers for mediasoup postinstall (compiles native worker on Alpine/musl)
RUN apk add --no-cache python3 py3-pip build-base linux-headers \
    && ln -sf /usr/bin/python3 /usr/bin/python \
    && ln -sf /usr/bin/gcc /usr/bin/cc && ln -sf /usr/bin/g++ /usr/bin/c++

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Copy workspace configuration (full dirs to preserve npm workspace structure)
COPY package.json package-lock.json* ./
COPY packages ./packages
COPY apps ./apps

# Install dependencies
RUN npm ci

# Build stage
FROM base AS builder
WORKDIR /app

# Copy dependencies and workspace config (required for -w @hmm/common)
COPY --from=deps /app/package.json /app/package-lock.json* ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages

# Copy source code (from deps to include apps/api-gateway/node_modules with @fastify/*)
COPY tsconfig.base.json ./
COPY --from=deps /app/apps/api-gateway ./apps/api-gateway
COPY packages ./packages

# Build shared packages (api-gateway has no Prisma schema - it's commented out)
RUN npm run build -w @hmm/common
WORKDIR /app/apps/api-gateway
RUN npm run build

# Production stage
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy built application
COPY --from=builder /app/apps/api-gateway/dist ./dist
COPY --from=builder /app/apps/api-gateway/package.json ./

# Copy shared packages and node_modules (builder has full deps; no npm ci in runner)
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/node_modules ./node_modules

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Run the service
CMD ["node", "dist/main.js"]
