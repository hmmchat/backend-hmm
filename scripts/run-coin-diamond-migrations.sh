#!/usr/bin/env bash
# Run coins/diamonds decouple migrations using each app's .env DATABASE_URL.
# From repo root: ./scripts/run-coin-diamond-migrations.sh
# See docs/COINS_AND_DIAMONDS.md for DB requirements (real Postgres URL; wallet DB must have wallets/transactions).
set -e
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

run_sql() {
  local url="$1"
  local file="$2"
  local name="$3"
  if [ -z "$url" ]; then echo "[$name] DATABASE_URL not set, skipping."; return 0; fi
  url="${url%%\?*}"
  if psql "$url" -v ON_ERROR_STOP=1 -f "$file" 2>/dev/null; then
    echo "[$name] Migration applied."
  else
    echo "[$name] Migration failed or psql not available. Run manually: psql \"\$DATABASE_URL\" -f $file"
    return 1
  fi
}

# Load .env from app dir and set DATABASE_URL (strip quotes)
load_env() {
  local env_file="$1"
  if [ ! -f "$env_file" ]; then return 1; fi
  local url
  url=$(grep -E '^DATABASE_URL=' "$env_file" | sed 's/^DATABASE_URL=//' | tr -d '"' | tr -d "'")
  echo "$url"
}

WALLET_URL=$(load_env apps/wallet-service/.env)
PAYMENT_URL=$(load_env apps/payment-service/.env)
FRIEND_URL=$(load_env apps/friend-service/.env)

echo "Running coins/diamonds decouple migrations..."
run_sql "$WALLET_URL" apps/wallet-service/prisma/migrations/20260204000000_add_diamonds_and_transaction_kind/migration.sql "wallet" || true
run_sql "$PAYMENT_URL" apps/payment-service/prisma/migrations/20260204000000_add_diamonds_deducted/migration.sql "payment" || true
run_sql "$FRIEND_URL" apps/friend-service/prisma/migrations/20260204000000_add_gift_diamonds/migration.sql "friend" || true
echo "Done. Proceed with next feature."
