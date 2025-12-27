# backend-hmm (hmmchat)

Backend service for hmmchat.live

- Domain: https://hmmchat.live
- App: https://app.hmmchat.live
- Staging App: https://staging.hmmchat.live
- API (planned): https://api.hmmchat.live

## Tech Stack

### Runtime & Language
- **Node.js**: v22+ (ESM modules)
- **TypeScript**: v5.6.3
- **Package Manager**: npm workspaces (with pnpm for some services)

### Frameworks & Libraries
- **NestJS**: v10.4.20 (used in auth-service)
  - Fastify adapter: @nestjs/platform-fastify v10.4.20
- **Prisma**: v6.0.0 (ORM)
- **Database**: PostgreSQL
- **Redis**: v5.10.0

### Authentication & Security
- **JWT**: jose v5.2.4 / v5.10.0
- **Password Hashing**: argon2 v0.40.3
- **OAuth Providers**:
  - Google: google-auth-library v9.14.2
  - Apple: (custom provider)
  - Facebook: (custom provider)
  - Phone: Twilio v5.3.6

### Validation & Utilities
- **Validation**: Zod v3.23.8 / v3.25.76
- **HTTP Client**: node-fetch v3.3.2

### Build & Tooling
- **Turborepo**: (monorepo orchestration)
- **TypeScript Config**: ES2022 target, NodeNext module resolution
- **CI/CD**: GitHub Actions

### Infrastructure
- **Storage**: Cloudflare R2
- **Database**: PostgreSQL
- **Cache**: Redis

### Architecture
- **Monorepo**: npm workspaces
- **Microservices**: 8 services (api-gateway, auth-service, discovery-service, files-service, moderation-service, payment-service, streaming-service, user-service, wallet-service)
- **Shared Packages**: 5 packages (common, config, logger, openapi, redis)

## Quick start (local)
1) Copy `.env.example` to `.env` and fill values.
2) Install dependencies:
   npm ci
3) Dev server (placeholder):
   npm run dev
4) Tests (placeholder):
   npm test

## Project Structure

```
backend-hmm/
├── apps/                          # Microservices
│   ├── api-gateway/               # API Gateway service
│   │   ├── prisma/
│   │   │   └── schema.prisma
│   │   ├── src/
│   │   │   └── main.ts
│   │   ├── test/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── README.md
│   │
│   ├── auth-service/              # Authentication service
│   │   ├── prisma/
│   │   │   └── schema.prisma
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   └── app.module.ts
│   │   │   ├── prisma/
│   │   │   │   └── prisma.service.ts
│   │   │   ├── routes/
│   │   │   │   ├── auth.controller.ts
│   │   │   │   └── me.controller.ts
│   │   │   ├── services/
│   │   │   │   ├── auth.service.ts
│   │   │   │   ├── metric.service.ts
│   │   │   │   └── providers/
│   │   │   │       ├── apple.provider.ts
│   │   │   │       ├── facebook.provider.ts
│   │   │   │       ├── google.provider.ts
│   │   │   │       └── phone.provider.ts
│   │   │   ├── main.ts
│   │   │   └── prisma.ts
│   │   ├── test/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── README.md
│   │
│   ├── discovery-service/         # Discovery service
│   │   ├── prisma/
│   │   │   └── schema.prisma
│   │   ├── src/
│   │   │   └── main.ts
│   │   ├── test/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── README.md
│   │
│   ├── files-service/             # File management service
│   │   ├── prisma/
│   │   │   └── schema.prisma
│   │   ├── src/
│   │   │   └── main.ts
│   │   ├── test/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── README.md
│   │
│   ├── moderation-service/        # Content moderation service
│   │   ├── prisma/
│   │   │   └── schema.prisma
│   │   ├── src/
│   │   │   └── main.ts
│   │   ├── test/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── README.md
│   │
│   ├── payment-service/          # Payment processing service
│   │   ├── prisma/
│   │   │   └── schema.prisma
│   │   ├── src/
│   │   │   └── main.ts
│   │   ├── test/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── README.md
│   │
│   ├── streaming-service/         # Streaming service
│   │   ├── prisma/
│   │   │   └── schema.prisma
│   │   ├── src/
│   │   │   └── main.ts
│   │   ├── test/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── README.md
│   │
│   ├── user-service/              # User management service
│   │   ├── prisma/
│   │   │   └── schema.prisma
│   │   ├── src/
│   │   │   └── main.ts
│   │   ├── test/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── README.md
│   │
│   └── wallet-service/            # Wallet service
│       ├── prisma/
│       │   └── schema.prisma
│       ├── src/
│       │   └── main.ts
│       ├── test/
│       ├── package.json
│       ├── tsconfig.json
│       └── README.md
│
├── packages/                      # Shared packages
│   ├── common/                    # Common utilities
│   │   ├── src/
│   │   │   └── index.ts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── README.md
│   │
│   ├── config/                    # Configuration package
│   │   ├── src/
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── README.md
│   │
│   ├── logger/                    # Logging package
│   │   ├── src/
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── README.md
│   │
│   ├── openapi/                   # OpenAPI utilities
│   │   ├── src/
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── README.md
│   │
│   └── redis/                     # Redis client package
│       ├── src/
│       │   └── index.ts
│       ├── package.json
│       └── README.md
│
├── scripts/                       # Build and utility scripts
│   └── merge-openapi.ts
│
├── src/                           # Root source files
│   └── index.js
│
├── package.json                   # Root package.json
├── pnpm-lock.yaml                 # pnpm lock file
├── tsconfig.base.json             # Base TypeScript config
├── turbo.json                     # Turborepo configuration
└── README.md                       # This file
```

## Help Prompt Template

When seeking help (AI assistants, forums, etc.), you can use this prompt:

```
I'm working on a backend microservices project with the following tech stack:

**Tech Stack & Versions:**
- Node.js: v22+ (ESM modules)
- TypeScript: v5.6.3
- NestJS: v10.4.20 (Fastify adapter)
- Prisma: v6.0.0
- PostgreSQL (database)
- Redis: v5.10.0
- Zod: v3.23.8 / v3.25.76 (validation)
- JWT: jose v5.2.4 / v5.10.0
- Password Hashing: argon2 v0.40.3
- OAuth: Google (google-auth-library v9.14.2), Apple, Facebook, Twilio v5.3.6
- Package Manager: npm workspaces (some services use pnpm)
- Build Tool: Turborepo
- TypeScript Config: ES2022 target, NodeNext module resolution, strict mode

**Project Structure:**
Monorepo with 8 microservices and 5 shared packages:

```
backend-hmm/
├── apps/                          # Microservices
│   ├── api-gateway/               # API Gateway service
│   ├── auth-service/              # Authentication service (NestJS)
│   │   ├── src/
│   │   │   ├── modules/app.module.ts
│   │   │   ├── routes/ (auth.controller.ts, me.controller.ts)
│   │   │   ├── services/ (auth.service.ts, metric.service.ts)
│   │   │   └── providers/ (apple, facebook, google, phone)
│   │   └── prisma/ (schema.prisma, prisma.service.ts)
│   ├── discovery-service/
│   ├── files-service/
│   ├── moderation-service/
│   ├── payment-service/
│   ├── streaming-service/
│   ├── user-service/
│   └── wallet-service/
│
├── packages/                      # Shared packages
│   ├── common/                    # Common utilities (jose, zod)
│   ├── config/                    # Configuration
│   ├── logger/                    # Logging
│   ├── openapi/                   # OpenAPI utilities
│   └── redis/                     # Redis client
│
├── scripts/                       # Build scripts
└── turbo.json                     # Turborepo config
```

**Architecture:**
- Monorepo using npm workspaces
- Microservices architecture
- Each service has its own Prisma schema
- Shared packages for common functionality
- TypeScript path aliases: @common/*, @config/*, @logger/*, @redis/*

[Your specific question or issue here]
```

## Contributing
- Feature branches → PR → main.
- See CONTRIBUTING.md.

Org: hmmchat • Repo: backend-hmm
