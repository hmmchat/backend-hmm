# backend-hmm (hmmchat)

Backend service for hmmchat.live

- Domain: https://hmmchat.live
- App: https://app.hmmchat.live
- Staging App: https://staging.hmmchat.live
- API: https://api.hmmchat.live (via API Gateway)

## Tech Stack

### Runtime & Language
- **Node.js**: v22+ (ESM modules)
- **TypeScript**: v5.6.3
- **Package Manager**: npm workspaces (with pnpm for some services)

### Frameworks & Libraries
- **NestJS**: v10.4.20 (used in auth-service, user-service, moderation-service)
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
- **Microservices**: 9 services
  - **api-gateway** - API Gateway service
  - **auth-service** - Authentication & authorization (Google, Apple, Facebook, Phone OTP)
  - **user-service** - User profile management & preferences
  - **moderation-service** - Content moderation (NSFW image checks)
  - **discovery-service** - User discovery & matching
  - **files-service** - File upload & storage (Cloudflare R2, image processing)
  - **payment-service** - Payment processing
  - **streaming-service** - Video/audio streaming
  - **wallet-service** - Wallet management
- **Shared Packages**: 5 packages (common, config, logger, openapi, redis)

## Quick start (local)

### Prerequisites
- Node.js v22+
- PostgreSQL
- Redis (optional, for metrics)

### Setup
1) Copy `.env.example` to `.env` in each service directory and fill values
2) Install dependencies:
   ```bash
   npm ci
   ```
3) Start services individually:
   ```bash
   # Auth Service (port 3001)
   cd apps/auth-service && npm run start:dev
   
   # User Service (port 3002)
   cd apps/user-service && npm run start:dev
   
   # Moderation Service (port 3003)
   cd apps/moderation-service && npm run start:dev
   ```
4) Run database migrations:
   ```bash
   # Auth Service
   cd apps/auth-service && npm run prisma:migrate
   
   # User Service
   cd apps/user-service && npm run prisma:migrate && npm run seed
   ```

See individual service README files for detailed setup instructions.

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
│   │   │   │   └── metrics.controller.ts
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
│   ├── user-service/              # User profile management service
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── migrations/
│   │   │   └── seed.ts
│   │   ├── src/
│   │   │   ├── modules/app.module.ts
│   │   │   ├── routes/user.controller.ts
│   │   │   ├── services/
│   │   │   │   ├── user.service.ts
│   │   │   │   ├── profile-completion.service.ts
│   │   │   │   └── moderation-client.service.ts
│   │   │   ├── dtos/profile.dto.ts
│   │   │   └── filters/zod-exception.filter.ts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── README.md
│   │   ├── MIGRATION.md
│   │   └── TESTING.md
│   │
│   ├── moderation-service/        # Content moderation service
│   │   ├── src/
│   │   │   ├── modules/app.module.ts
│   │   │   ├── routes/moderation.controller.ts
│   │   │   ├── services/moderation.service.ts
│   │   │   └── filters/zod-exception.filter.ts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── README.md
│   │   └── TESTING.md
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
Monorepo with 9 microservices and 5 shared packages:

```
backend-hmm/
├── apps/                          # Microservices
│   ├── api-gateway/               # API Gateway service
│   ├── auth-service/              # Authentication service (OAuth + Phone OTP)
│   │   ├── src/
│   │   │   ├── modules/app.module.ts
│   │   │   ├── routes/ (auth.controller.ts, metrics.controller.ts)
│   │   │   ├── services/ (auth.service.ts, metric.service.ts)
│   │   │   └── providers/ (apple, facebook, google, phone)
│   │   └── prisma/ (schema.prisma, prisma.service.ts)
│   ├── user-service/              # User profile management
│   │   ├── src/
│   │   │   ├── modules/app.module.ts
│   │   │   ├── routes/ (user.controller.ts)
│   │   │   ├── services/ (user.service.ts, profile-completion.service.ts)
│   │   │   └── dtos/ (profile.dto.ts)
│   │   └── prisma/ (schema.prisma, migrations, seed.ts)
│   ├── moderation-service/        # Content moderation (NSFW checks)
│   │   ├── src/
│   │   │   ├── modules/app.module.ts
│   │   │   ├── routes/ (moderation.controller.ts)
│   │   │   └── services/ (moderation.service.ts)
│   ├── discovery-service/
│   ├── files-service/
│   ├── payment-service/
│   ├── streaming-service/
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

**Implemented Services:**
- ✅ auth-service - Authentication (OAuth + Phone OTP)
- ✅ user-service - User profile management
- ✅ moderation-service - Content moderation (NSFW checks)

**Services in Development:**
- 🚧 discovery-service
- 🚧 files-service
- 🚧 payment-service
- 🚧 streaming-service
- 🚧 wallet-service
- 🚧 api-gateway

**Implemented Services:**
- ✅ auth-service - Authentication (OAuth + Phone OTP)
- ✅ user-service - User profile management
- ✅ moderation-service - Content moderation (NSFW checks)

**Services in Development:**
- 🚧 discovery-service
- 🚧 files-service
- 🚧 payment-service
- 🚧 streaming-service
- 🚧 wallet-service
- 🚧 api-gateway

[Your specific question or issue here]
```

## Contributing
- Feature branches → PR → main.
- See CONTRIBUTING.md.

Org: hmmchat • Repo: backend-hmm
