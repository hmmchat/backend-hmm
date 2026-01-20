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
5. ✅ Handles failed migrations automatically
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

The script automatically:
- Resolves failed migrations
- Uses `db push` to sync schema (handles drift)
- Marks migrations as applied

### Services missing .env files

The script will warn about missing `.env` files but continue with other services. Make sure to create `.env` files for services that need database access.

## Notes

- The script is **idempotent** - safe to run multiple times
- Uses `prisma db push` for reliable schema syncing in development
- Automatically handles migration conflicts and failed migrations
- Provides colored output for easy reading
