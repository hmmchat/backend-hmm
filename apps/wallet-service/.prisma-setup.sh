#!/bin/bash
# Quick setup script for wallet-service Prisma client
# Run this if you encounter Prisma client issues

set -e

cd "$(dirname "$0")"

echo "🔧 Setting up wallet-service Prisma client..."

# Ensure .npmrc exists
if [ ! -f .npmrc ]; then
  echo "Creating .npmrc file..."
  cat > .npmrc << 'NPMRC_EOF'
# Prevent hoisting of Prisma clients to root
# Each service should have its own isolated Prisma client
@prisma/client:false
.prisma:false
NPMRC_EOF
fi

# Generate Prisma client (may fail with pnpm error, that's ok)
echo "Generating Prisma client..."
npx prisma generate --schema=prisma/schema.prisma 2>&1 | grep -v "pnpm add" || true

# Ensure symlink exists
echo "Creating @prisma/client symlink..."
rm -rf node_modules/@prisma/client
ln -s ../.prisma/client node_modules/@prisma/client 2>/dev/null || {
  # Fallback: create package.json
  mkdir -p node_modules/@prisma/client
  cat > node_modules/@prisma/client/package.json << 'PKG_EOF'
{
  "name": "@prisma/client",
  "main": "../.prisma/client/index.js",
  "types": "../.prisma/client/index.d.ts"
}
PKG_EOF
}

echo "✅ Wallet-service Prisma client setup complete!"
echo "Run: npx tsc --noEmit  (to verify TypeScript compilation)"
