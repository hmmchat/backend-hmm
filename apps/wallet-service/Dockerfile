# Multi-stage build for wallet-service
FROM node:22-alpine AS base

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

# Copy dependencies
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages

# Copy source code
COPY tsconfig.base.json ./
COPY apps/wallet-service ./apps/wallet-service
COPY packages ./packages

# Build the service
WORKDIR /app/apps/wallet-service
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

# Copy shared packages
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Install production dependencies only
RUN npm ci --omit=dev && npm cache clean --force

# Generate Prisma Client
RUN npx prisma generate

# Expose port
EXPOSE 3006

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3006/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Run the service
CMD ["node", "dist/main.js"]
