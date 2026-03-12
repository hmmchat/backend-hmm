#!/bin/bash
# Create all service databases on first Postgres container startup.
# Runs from /docker-entrypoint-initdb.d (only when data volume is empty).

set -e

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

for db in "${DATABASES[@]}"; do
  if psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" -d postgres -tc "SELECT 1 FROM pg_database WHERE datname = '${db}'" | grep -q 1; then
    echo "Database ${db} already exists"
  else
    echo "Creating database ${db}"
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" -d postgres <<-EOSQL
      CREATE DATABASE "${db}";
EOSQL
  fi
done

echo "All databases created"
