# Multi-stage build for wallet-service
FROM node:22-slim AS base
# Python + build-essential + linux headers for native module builds
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip build-essential linux-headers-amd64 \
    && rm -rf /var/lib/apt/lists/* \
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

# Copy source code
COPY tsconfig.base.json ./
COPY apps/wallet-service ./apps/wallet-service
COPY packages ./packages

# Build shared packages and generate Prisma client
RUN npm run build -w @hmm/common
WORKDIR /app/apps/wallet-service
RUN npx prisma generate --schema=prisma/schema.prisma
RUN npm run build

# Production stage
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy built application
COPY --from=builder /app/apps/wallet-service/dist ./dist
COPY --from=builder /app/apps/wallet-service/package.json ./
COPY --from=builder /app/apps/wallet-service/prisma ./prisma
COPY --from=builder /app/apps/wallet-service/scripts ./scripts

# Copy shared packages and node_modules (builder has full deps; no npm ci in runner)
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/wallet-service/node_modules/.prisma ./node_modules/.prisma

# Generate Prisma Client (schema present; DATABASE_URL from runtime env)
RUN npx prisma generate --schema=prisma/schema.prisma

# Expose port
EXPOSE 3005

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3005/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Run the service
CMD ["node", "dist/main.js"]
