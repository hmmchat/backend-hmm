# Setup Scripts

This directory contains setup and maintenance scripts for the HMM backend.

## Prerequisites Script

**File:** `setup-prerequisites.sh`

Ensures all Prisma databases are migrated and up-to-date. **Run this before testing!**

### Usage

```bash
# From project root
bash scripts/setup-prerequisites.sh
```

### What it does:

1. ✅ Checks PostgreSQL is running
2. ✅ Checks Redis is running (optional)
3. ✅ Generates Prisma clients for all services
4. ✅ Syncs all database schemas using `prisma db push`
5. ✅ Handles failed migrations (per-service) automatically
6. ✅ Verifies critical tables exist

### When to run:

- ✅ After cloning the repository
- ✅ After pulling new migrations
- ✅ When you see database/table errors
- ✅ Before running the HTML test interface
- ✅ After switching branches with schema changes

### Services handled:

- auth-service
- user-service
- discovery-service
- streaming-service
- wallet-service
- files-service
- payment-service
- friend-service
- moderation-service
- ads-service

### Local dev (without Docker):

If databases don't exist yet, run first:

```bash
bash scripts/create-databases-local.sh
```

Then run `setup-prerequisites.sh`. With Docker Compose, databases are created automatically on first startup.

**Credentials:** Default is `postgres:postgres`. All `.env.example` files use this. If your Postgres uses different credentials, set `PGPASSWORD` when running `create-databases-local.sh` and update each service `.env` accordingly.

## Quick Setup Script

**File:** `quick-setup.sh`

Convenience wrapper that runs prerequisites and provides next steps.

```bash
bash scripts/quick-setup.sh
```

## Troubleshooting

### "relation does not exist" errors

If you see errors like:
```
relation "active_matches" does not exist
```

Run:
```bash
bash scripts/setup-prerequisites.sh
```

This will sync all schemas and create missing tables.

### Migration conflicts

Each service has its own database (Option A). No cross-service migration conflicts. The script:
- Resolves failed migrations per service
- Uses `db push` to sync schema (handles drift)
- Marks migrations as applied

### Database setup

- **Docker Compose**: Databases are created automatically via `scripts/postgres-init/create-databases.sh` on first Postgres startup.
- **Local Postgres**: Run `scripts/create-databases-local.sh` before `setup-prerequisites.sh` if databases don't exist.

### Services missing .env files

The script will warn about missing `.env` files but continue with other services. Make sure to create `.env` files for services that need database access.

## Notes

- The script is **idempotent** - safe to run multiple times
- Uses `prisma db push` for reliable schema syncing in development
- Each service has its own database (Option A) - no shared DBs, no cross-service migration conflicts
- Provides colored output for easy reading
