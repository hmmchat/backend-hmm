# Multi-stage build for streaming-service
FROM node:22-alpine AS base
# Python + build deps for mediasoup (postinstall + native worker build on Alpine/musl)
RUN apk add --no-cache python3 py3-pip build-base linux-headers \
    openssl-dev libvpx-dev opus-dev libsrtp-dev \
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
COPY apps/streaming-service ./apps/streaming-service
COPY packages ./packages

# Build shared packages and generate Prisma client
RUN npm run build -w @hmm/common
WORKDIR /app/apps/streaming-service
RUN npx prisma generate --schema=prisma/schema.prisma
RUN npm run build

# Production stage
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy built application
COPY --from=builder /app/apps/streaming-service/dist ./dist
COPY --from=builder /app/apps/streaming-service/package.json ./
COPY --from=builder /app/apps/streaming-service/prisma ./prisma
COPY --from=builder /app/apps/streaming-service/scripts ./scripts

# Copy shared packages
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Install production dependencies only
RUN npm ci --omit=dev && npm cache clean --force

# Generate Prisma Client
RUN npx prisma generate

# Expose port
EXPOSE 3005

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3005/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Run the service
CMD ["node", "dist/main.js"]
