#!/bin/bash
# Create all service databases for local development (without Docker).
# Run this before setup-prerequisites.sh if your Postgres has no databases yet.
#
# Uses: PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres (defaults)
# Override with env vars if your local Postgres uses different credentials.
# Ensure each service .env uses matching credentials: postgresql://postgres:postgres@...

set -e

PGHOST="${PGHOST:-localhost}"
PGUSER="${PGUSER:-postgres}"
PGPORT="${PGPORT:-5432}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

DATABASES=(
  "auth-service"
  "user-service"
  "discovery-service"
  "wallet-service"
  "streaming-service"
  "friend-service"
  "payment-service"
  "files-service"
  "moderation-service"
  "ads-service"
)

echo "Creating databases (host=${PGHOST} user=${PGUSER})..."

for db in "${DATABASES[@]}"; do
  if psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -tc "SELECT 1 FROM pg_database WHERE datname = '${db}'" 2>/dev/null | grep -q 1; then
    echo "  ${db} - already exists"
  else
    psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -c "CREATE DATABASE \"${db}\";" && echo "  ${db} - created"
  fi
done

echo "Done. Run setup-prerequisites.sh next."
