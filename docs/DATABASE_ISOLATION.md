# Database Isolation and Table Ownership

## Overview

This document defines table ownership and database isolation strategy to prevent accidental table drops when running Prisma migrations.

## Database Structure

### Shared Database: `hmm_user`

This database contains core user and shared data that multiple services need to access.

#### Table Ownership

| Table | Owner Service | Used By | Access Method |
|-------|--------------|---------|---------------|
| `users` | user-service | All services | HTTP API (user-service) |
| `user_photos` | user-service | All services | HTTP API (user-service) |
| `songs` | user-service | All services | HTTP API (user-service) |
| `brands` | user-service | All services | HTTP API (user-service) |
| `user_brands` | user-service | All services | HTTP API (user-service) |
| `interests` | user-service | All services | HTTP API (user-service) |
| `user_interests` | user-service | All services | HTTP API (user-service) |
| `values` | user-service | All services | HTTP API (user-service) |
| `user_values` | user-service | All services | HTTP API (user-service) |
| `user_badges` | user-service | All services | HTTP API (user-service) |
| `wallets` | wallet-service | payment-service, friend-service, discovery-service | HTTP API (wallet-service) |
| `transactions` | wallet-service | payment-service, friend-service, discovery-service | HTTP API (wallet-service) |
| `gender_filter_preferences` | discovery-service | discovery-service only | Direct DB access |
| `raincheck_sessions` | discovery-service | discovery-service only | Direct DB access |
| `active_matches` | discovery-service | discovery-service only | Direct DB access |
| `match_acceptances` | discovery-service | discovery-service only | Direct DB access |
| `squad_invitations` | discovery-service | discovery-service only | Direct DB access |
| `squad_lobbies` | discovery-service | discovery-service only | Direct DB access |
| `broadcast_view_history` | discovery-service | discovery-service only | Direct DB access |
| `broadcast_comments` | discovery-service | discovery-service only | Direct DB access |
| `broadcast_shares` | discovery-service | discovery-service only | Direct DB access |
| `broadcast_follows` | discovery-service | discovery-service only | Direct DB access |

### Service-Specific Databases

| Service | Database | Tables |
|---------|----------|--------|
| `friend-service` | `friend-service` | `friend_requests`, `friends`, `friend_messages`, `conversations`, `gifts` |
| `streaming-service` | `streaming-service` | `rooms`, `calls`, `broadcasts`, etc. |
| `files-service` | `files-service` | `files` |
| `payment-service` | `payment-service` | `payment_orders`, etc. |
| `auth-service` | `auth-service` | `users` (auth), `sessions` |
| `moderation-service` | `moderation-service` | `dare_submissions`, etc. |

## Migration Strategy

### ❌ DO NOT USE (Dangerous)
```bash
npm run prisma:push  # Can drop tables not in schema!
```

### ✅ USE INSTEAD (Safe)
```bash
# Development
npm run prisma:migrate dev

# Production
npm run prisma:deploy
```

## Schema Rules

1. **Each service schema should ONLY include tables it owns**
2. **Do NOT duplicate table definitions across schemas**
3. **Services access other services' tables via HTTP APIs, not direct Prisma queries**
4. **If a service needs to read another service's table, use HTTP API calls**

## Example: Correct Schema Structure

### user-service/prisma/schema.prisma
```prisma
// ✅ OWNED by user-service
model User { ... }
model UserPhoto { ... }
model Song { ... }
model Brand { ... }
model UserBrand { ... }
model Interest { ... }
model UserInterest { ... }
model Value { ... }
model UserValue { ... }
model UserBadge { ... }

// ❌ DO NOT include:
// - Wallet, Transaction (owned by wallet-service)
// - ActiveMatch, MatchAcceptance (owned by discovery-service)
// - GenderFilterPreference (owned by discovery-service)
```

### wallet-service/prisma/schema.prisma
```prisma
// ✅ OWNED by wallet-service
model Wallet { ... }
model Transaction { ... }

// ❌ DO NOT include:
// - User (owned by user-service - access via HTTP API)
// - GenderFilterPreference (owned by discovery-service)
```

### discovery-service/prisma/schema.prisma
```prisma
// ✅ OWNED by discovery-service
model GenderFilterPreference { ... }
model RaincheckSession { ... }
model ActiveMatch { ... }
model MatchAcceptance { ... }
model SquadInvitation { ... }
model SquadLobby { ... }
model BroadcastViewHistory { ... }
model BroadcastComment { ... }
model BroadcastShare { ... }
model BroadcastFollow { ... }

// ❌ DO NOT include:
// - User (owned by user-service - access via HTTP API)
// - Wallet, Transaction (owned by wallet-service - access via HTTP API)
```

## Benefits

1. **No Data Duplication**: Single source of truth for each table
2. **No Inconsistency**: All services read from same database
3. **Safe Migrations**: Migrations only affect tables in that service's schema
4. **Clear Ownership**: Each table has one owner responsible for its schema
5. **Isolation**: One service's migration won't affect another service's tables

## Migration Process

When adding a new table or modifying an existing one:

1. **Identify the owner service** (which service creates/manages this data?)
2. **Add table to owner service's schema only**
3. **Create migration**: `cd apps/<owner-service> && npm run prisma:migrate dev`
4. **Other services access via HTTP API** (if needed)

## Testing

After removing duplicate tables:
1. Each service should start successfully
2. Services should access their own tables via Prisma
3. Services should access other services' tables via HTTP APIs
4. Running migrations on one service should NOT affect other services' tables
