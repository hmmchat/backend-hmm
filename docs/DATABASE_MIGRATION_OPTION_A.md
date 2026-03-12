# Production Data Migration: Option A (Separate Database Per Service)

This document describes how to migrate production from a legacy shared database to Option A, where each service has its own database.

## Why Option A: Prisma and Data Persistence

**Prisma migration conflicts (prevented):** Previously, multiple services sharing a single database wrote to the same `_prisma_migrations` table. A failed migration in one service (e.g. wallet-service) could block others. With Option A, each service has its own database and `_prisma_migrations` table. Migrations are isolated; one service's failure does not affect others.

**Data persistence:** Each service's data lives in its own database. Docker Compose uses a single Postgres instance with multiple databases; the `postgres_data` volume persists all of them. In production, you can use separate Postgres instances per service or a shared instance with separate databases. Data persists correctly in either case.

## When to Use This

- If discovery-service was previously using a shared database and has data
- If you need to migrate existing discovery tables (active_matches, gender_filter_preferences, raincheck_sessions, squad_invitations, etc.) to a new `discovery-service` database

## Prerequisites

- Access to production PostgreSQL
- `pg_dump` and `psql` available
- Maintenance window or low-traffic period

## Migration Steps

### 1. Create discovery-service database

```bash
psql -h localhost -U postgres -d postgres -c 'CREATE DATABASE "discovery-service";'
```

### 2. Dump discovery tables from source database

Set `SOURCE_DB` to your legacy shared database name, then run:

Discovery-service owns these tables:

- gender_filter_preferences
- raincheck_sessions
- active_matches
- match_acceptances
- squad_invitations
- squad_lobbies
- broadcast_view_history
- broadcast_comments
- broadcast_shares
- broadcast_follows

```bash
SOURCE_DB="your-legacy-db-name"  # e.g. the shared DB discovery used before
pg_dump -h localhost -U postgres -d "$SOURCE_DB" \
  -t gender_filter_preferences \
  -t raincheck_sessions \
  -t active_matches \
  -t match_acceptances \
  -t squad_invitations \
  -t squad_lobbies \
  -t broadcast_view_history \
  -t broadcast_comments \
  -t broadcast_shares \
  -t broadcast_follows \
  --schema-only \
  -f discovery_schema.sql
```

For data migration:

```bash
SOURCE_DB="your-legacy-db-name"
pg_dump -h localhost -U postgres -d "$SOURCE_DB" \
  -t gender_filter_preferences \
  -t raincheck_sessions \
  -t active_matches \
  -t match_acceptances \
  -t squad_invitations \
  -t squad_lobbies \
  -t broadcast_view_history \
  -t broadcast_comments \
  -t broadcast_shares \
  -t broadcast_follows \
  -f discovery_data.sql
```

### 3. Apply schema and data to discovery-service database

```bash
# Apply schema first (Prisma migrations may have already run; if not, run deploy)
psql -h localhost -U postgres -d discovery-service -f discovery_schema.sql

# Apply data
psql -h localhost -U postgres -d discovery-service -f discovery_data.sql
```

Alternatively, run Prisma migrations on the new database:

```bash
cd apps/discovery-service
DATABASE_URL="postgresql://user:pass@host:5432/discovery-service?schema=public" npx prisma migrate deploy
```

Then restore only data (no schema) if you used migrations:

```bash
SOURCE_DB="your-legacy-db-name"
pg_dump -h localhost -U postgres -d "$SOURCE_DB" \
  -t gender_filter_preferences \
  -t raincheck_sessions \
  -t active_matches \
  -t match_acceptances \
  -t squad_invitations \
  -t squad_lobbies \
  -t broadcast_view_history \
  -t broadcast_comments \
  -t broadcast_shares \
  -t broadcast_follows \
  --data-only \
  -f discovery_data_only.sql

psql -h localhost -U postgres -d discovery-service -f discovery_data_only.sql
```

### 4. Update discovery-service DATABASE_URL

Update the discovery-service environment variable:

```
DATABASE_URL=postgresql://user:password@host:5432/discovery-service?schema=public
```

### 5. Deploy discovery-service

Deploy the updated discovery-service with the new DATABASE_URL.

### 6. Verify

- Run discovery flows: match, raincheck, squad invite
- Check that discovery-service health endpoint responds
- Verify no errors in discovery-service logs

### 7. Optional: Clean up source database

After validation (e.g. 24–48 hours), optionally drop discovery tables from the legacy database:

```sql
-- Only if the source database is no longer used by discovery-service
DROP TABLE IF EXISTS broadcast_follows;
DROP TABLE IF EXISTS broadcast_shares;
DROP TABLE IF EXISTS broadcast_comments;
DROP TABLE IF EXISTS broadcast_view_history;
DROP TABLE IF EXISTS squad_lobbies;
DROP TABLE IF EXISTS squad_invitations;
DROP TABLE IF EXISTS match_acceptances;
DROP TABLE IF EXISTS active_matches;
DROP TABLE IF EXISTS raincheck_sessions;
DROP TABLE IF EXISTS gender_filter_preferences;
```

## Rollback

If issues occur, revert discovery-service DATABASE_URL to the legacy database and redeploy. The original data remains until you drop the tables.
