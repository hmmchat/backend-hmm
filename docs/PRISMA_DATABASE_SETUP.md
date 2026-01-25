# Prisma Database Setup Guide

This guide explains how to properly set up Prisma databases for all services, both in development and production.

## 🚨 Common Error: "Table does not exist"

If you see errors like:
```
Invalid `prisma.user.findUnique()` invocation:
The table `public.users` does not exist in the current database.
```

This means the database schema hasn't been initialized. Follow the steps below to fix it.

## 🛠️ Development Setup

**✅ We use Prisma Migrations everywhere (dev and prod) for consistency!**

### Quick Fix (Single Service)

If a specific service is missing tables:

```bash
cd apps/<service-name>
npx prisma migrate deploy
npx prisma generate
```

If the service has no migrations yet, create the initial one:
```bash
cd apps/<service-name>
npx prisma migrate dev --name init
```

### Complete Setup (All Services)

Run the automated setup script:

```bash
./scripts/setup-and-start-services.sh
```

This script will:
1. Check PostgreSQL is running
2. Generate Prisma clients for all services
3. **Deploy migrations** (creates/updates all tables using migrations)
4. Create initial migrations for services that don't have them yet
5. Start all services

**Why migrations instead of `db push`?**
- ✅ Same workflow in dev and production
- ✅ Version-controlled schema changes
- ✅ No "table does not exist" errors
- ✅ Better error handling and rollback capability
- ✅ Migration history for debugging

### Manual Setup (Step by Step)

1. **Ensure PostgreSQL is running:**
   ```bash
   # macOS
   brew services start postgresql
   
   # Linux
   sudo systemctl start postgresql
   ```

2. **For each service with Prisma:**
   ```bash
   cd apps/user-service  # or auth-service, discovery-service, etc.
   npx prisma generate
   
   # If migrations exist:
   npx prisma migrate deploy
   
   # If no migrations exist yet:
   npx prisma migrate dev --name init
   ```

3. **Services with Prisma schemas:**
   - `auth-service`
   - `user-service`
   - `discovery-service`
   - `streaming-service`
   - `wallet-service`
   - `files-service`
   - `payment-service`
   - `friend-service`
   - `moderation-service`

## 🚀 Production Setup

**✅ Same as development - use `prisma migrate deploy` everywhere!**

### Production Migration Strategy

1. **Deploy Migrations:**
   ```bash
   cd apps/<service-name>
   npx prisma migrate deploy
   ```

2. **In CI/CD Pipeline:**
   ```yaml
   - name: Deploy Prisma Migrations
     run: |
       cd apps/user-service
       npx prisma migrate deploy
   ```

3. **Docker/Container Setup:**
   ```dockerfile
   # Run migrations before starting the service
   RUN npx prisma migrate deploy
   CMD ["node", "dist/main.js"]
   ```

**Note:** The setup script uses the same migration approach, so dev and prod are identical!

### Migration Workflow

1. **Create a migration:**
   ```bash
   cd apps/user-service
   npx prisma migrate dev --name add_new_field
   ```

2. **Review the migration:**
   - Check `prisma/migrations/` directory
   - Review the SQL in the migration file

3. **Apply in production:**
   ```bash
   npx prisma migrate deploy
   ```

## 🔍 Verification

### Check if Tables Exist

```bash
# Connect to PostgreSQL
psql -U postgres -d hmm_user

# List tables
\dt

# Check specific table
SELECT * FROM users LIMIT 1;
```

### Service Health Check

Services now validate database schema on startup. If tables are missing, the service will:
- **Fail to start** with a clear error message
- Provide instructions on how to fix it

## 🐛 Troubleshooting

### Error: "Table does not exist"

**Cause:** Database schema not initialized or migrations not applied.

**Fix:**
```bash
cd apps/<service-name>
npx prisma migrate deploy
```

If no migrations exist:
```bash
npx prisma migrate dev --name init
```

### Error: "Prisma Client not generated"

**Fix:**
```bash
cd apps/<service-name>
npx prisma generate
```

### Error: "Connection refused"

**Cause:** PostgreSQL not running or wrong DATABASE_URL.

**Fix:**
1. Check PostgreSQL is running
2. Verify DATABASE_URL in `.env` file
3. Test connection: `psql $DATABASE_URL`

### Error: "Migration failed"

**Cause:** Conflicting migrations or database state.

**Fix:**
```bash
# Check migration status
npx prisma migrate status

# Reset (DEVELOPMENT ONLY - will lose data!)
npx prisma migrate reset

# Or resolve manually
npx prisma migrate resolve --applied <migration-name>
```

## 📋 Best Practices

1. **Development & Production (Same Approach!):**
   - ✅ Always use `prisma migrate deploy` to apply migrations
   - ✅ Use `prisma migrate dev` to create new migrations when schema changes
   - ✅ Never use `prisma db push` (inconsistent, can cause errors)
   - ✅ Run migrations before starting services

2. **Creating New Migrations:**
   ```bash
   # After changing schema.prisma
   cd apps/<service-name>
   npx prisma migrate dev --name descriptive_name
   ```

3. **CI/CD:**
   - Add migration step to deployment pipeline
   - Verify migrations succeed before deploying code
   - Keep migration files in version control
   - Use `prisma migrate deploy` (same command everywhere)

4. **Monitoring:**
   - Services validate schema on startup
   - Check service logs for database errors
   - Set up alerts for "table does not exist" errors
   - Check migration status: `npx prisma migrate status`

## 🔗 Related Files

- Setup script: `scripts/setup-and-start-services.sh`
- Prisma schemas: `apps/*/prisma/schema.prisma`
- Migration files: `apps/*/prisma/migrations/`

## 📚 Additional Resources

- [Prisma Migrate Guide](https://www.prisma.io/docs/concepts/components/prisma-migrate)
- [Prisma Deployment Guide](https://www.prisma.io/docs/guides/deployment)
