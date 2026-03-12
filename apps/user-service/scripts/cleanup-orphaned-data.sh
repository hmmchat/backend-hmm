#!/bin/bash
# Cleanup orphaned data in junction tables before seeding
# This prevents unique constraint violations when reseeding

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$SERVICE_DIR"

# Use DATABASE_URL from .env if set, otherwise fallback to user-service for local dev
if [ -f ".env" ] && grep -q "^DATABASE_URL=" .env 2>/dev/null; then
  DATABASE_URL=$(grep "^DATABASE_URL=" .env | cut -d'=' -f2- | tr -d '"' | tr -d "'")
fi

DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/user-service?schema=public}"

psql "$DATABASE_URL" <<EOF
-- Clean up orphaned junction table data
DELETE FROM user_interests WHERE "userId" NOT IN (SELECT id FROM users);
DELETE FROM user_values WHERE "userId" NOT IN (SELECT id FROM users);
DELETE FROM user_brands WHERE "userId" NOT IN (SELECT id FROM users);
DELETE FROM user_photos WHERE "userId" NOT IN (SELECT id FROM users);

-- Show what was cleaned
SELECT 'Cleaned orphaned data' AS status;
EOF

echo "✅ Cleanup completed"
