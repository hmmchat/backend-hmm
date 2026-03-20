# Multi-stage build for friend-service
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
COPY apps/friend-service ./apps/friend-service
COPY packages ./packages

# Build shared packages and generate Prisma client
RUN npm run build -w @hmm/common
WORKDIR /app/apps/friend-service
RUN npx prisma generate --schema=prisma/schema.prisma
RUN npm run build

# Production stage
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Install Chromium dependencies for Puppeteer
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      chromium \
      ca-certificates \
      fonts-freefont-ttf \
    && rm -rf /var/lib/apt/lists/*

# Set Puppeteer to use system Chrome
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Copy built application
COPY --from=builder /app/apps/friend-service/dist ./dist
COPY --from=builder /app/apps/friend-service/package.json ./
COPY --from=builder /app/apps/friend-service/prisma ./prisma
COPY --from=builder /app/apps/friend-service/scripts ./scripts

# Copy shared packages and node_modules (builder has full deps; no npm ci in runner)
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/friend-service/node_modules/.prisma ./node_modules/.prisma

# Generate Prisma Client (schema present; DATABASE_URL from runtime env)
RUN npx prisma generate --schema=prisma/schema.prisma

# Expose port
EXPOSE 3009

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3009/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Run the service
# Run DB migrations before starting the server so production deploys
# don't fail with "table does not exist" / schema drift.
CMD ["sh", "-lc", "npx prisma migrate deploy --schema=prisma/schema.prisma && node dist/main.js"]
