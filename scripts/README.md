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

**Prerequisites:** PostgreSQL and Redis must be running before setup.

```bash
# Start Redis (required for friend-service)
brew services start redis

# Create databases if needed
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

### Check service health (manual)

**File:** `check-services-health.sh`

Uses the correct health endpoint for each service (payment uses `/v1/payments/health`):

```bash
bash scripts/check-services-health.sh
```

### Services not responding (connection refused)

If you see `000fail` or connection refused for streaming-service, files-service, friend-service, or ads-service:

1. **Wait for startup** – `npm run dev` takes 2–5 minutes. Run the health check after it completes.
2. **Check logs** – `tail -50 /tmp/<service-name>.log` for errors.
3. **Redis** – friend-service needs Redis. Start with `brew services start redis`.
4. **Mediasoup** – streaming-service uses ports 40000–49999. Ensure they're not blocked.
5. **Database** – run `bash scripts/create-databases-local.sh` if databases don't exist.

## Notes

- The script is **idempotent** - safe to run multiple times
- Uses `prisma db push` for reliable schema syncing in development
- Each service has its own database (Option A) - no shared DBs, no cross-service migration conflicts
- Provides colored output for easy reading
