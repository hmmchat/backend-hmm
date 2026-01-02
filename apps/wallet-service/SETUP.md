# Wallet Service Setup Guide

## Prerequisites

1. Ensure `.npmrc` file exists in `apps/wallet-service/` directory:
   ```
   # Prevent hoisting of Prisma clients to root
   # Each service should have its own isolated Prisma client
   @prisma/client:false
   .prisma:false
   ```

2. Ensure `@prisma/client` version is exact (not caret):
   ```json
   "@prisma/client": "6.0.0"
   ```

## Initial Setup

Run the following commands to set up the wallet-service:

```bash
cd apps/wallet-service

# Install dependencies
npm install

# Generate Prisma client (this should create the symlink automatically)
npm run prisma:generate

# Verify Prisma client is set up correctly
ls -la node_modules/@prisma/client
# Should show: node_modules/@prisma/client -> ../.prisma/client
```

## If Prisma Client Generation Fails

If you see errors about `pnpm`, try generating the client directly:

```bash
# Temporarily remove .npmrc if generation fails
mv .npmrc .npmrc.bak

# Generate Prisma client
npx prisma generate --schema=prisma/schema.prisma

# Restore .npmrc
mv .npmrc.bak .npmrc

# Create symlink manually if needed
rm -rf node_modules/@prisma/client
ln -s ../.prisma/client node_modules/@prisma/client
```

## Verification

After setup, verify everything works:

```bash
# Check TypeScript compilation
npx tsc --noEmit

# Start the service
npm run start:dev

# In another terminal, test the endpoint
curl http://localhost:3005/me/balance
# Should return: {"statusCode":401,"message":"Missing token"}
```

## Troubleshooting

### Issue: "Property 'wallet' does not exist on type 'PrismaService'"

**Solution:** The Prisma client symlink is missing or incorrect.

```bash
cd apps/wallet-service
rm -rf node_modules/@prisma/client
npm run prisma:generate
# OR manually:
ln -s ../.prisma/client node_modules/@prisma/client
```

### Issue: Prisma generate fails with "pnpm add" error

**Solution:** Generate without the .npmrc file temporarily, or ensure the postinstall script creates the symlink correctly.

### Issue: TypeScript errors in wallet.service.ts

**Solution:** Ensure the Prisma client types are generated and the symlink is correct. Run:
```bash
npm run prisma:generate
npx tsc --noEmit
```

## Key Differences from Other Services

Wallet-service requires the same setup as user-service:
- `.npmrc` file to prevent Prisma client hoisting
- Exact Prisma client version (not `^6.0.0`)
- Symlink from `node_modules/@prisma/client` to `node_modules/.prisma/client`
- Proper postinstall script to create the symlink

