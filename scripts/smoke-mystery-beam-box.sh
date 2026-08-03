#!/usr/bin/env bash
# Smoke checks for Mystery Beam Box wiring (no live DB required).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HMM="${HMM_APP_ROOT:-$HOME/hmm..}"
DASH="${DASHBOARD_ROOT:-$HOME/beam-dashboard}"

fail=0
check() {
  local path="$1"
  if [[ -f "$path" || -d "$path" ]]; then
    echo "OK  $path"
  else
    echo "MISS $path"
    fail=1
  fi
}

echo "== wallet-service =="
check "$ROOT/apps/wallet-service/src/services/season.service.ts"
check "$ROOT/apps/wallet-service/src/routes/season.controller.ts"
check "$ROOT/apps/wallet-service/src/routes/season-admin.controller.ts"
check "$ROOT/apps/wallet-service/prisma/migrations/20260803120000_mystery_beam_box_seasons/migration.sql"

echo "== streaming-service =="
check "$ROOT/apps/streaming-service/src/services/season-progress.service.ts"

echo "== gateway =="
grep -q 'admin/seasons' "$ROOT/apps/api-gateway/src/services/routing.service.ts" && echo "OK  gateway /admin/seasons route" || { echo "MISS gateway route"; fail=1; }

echo "== frontend =="
check "$HMM/components/Profile/MysteryBeamBoxPanel.jsx"
check "$HMM/lib/indiaAddress.js"
grep -q 'SEASON' "$HMM/lib/api.js" && echo "OK  API.SEASON" || { echo "MISS API.SEASON"; fail=1; }

echo "== dashboard =="
check "$DASH/src/components/sections/SeasonOpsSection.tsx"
check "$DASH/src/app/dashboard/season-ops/page.tsx"
check "$DASH/src/lib/season-ops-auth.ts"

echo "== typecheck =="
(cd "$ROOT/apps/wallet-service" && npx tsc --noEmit -p tsconfig.json) && echo "OK  wallet tsc"
(cd "$ROOT/apps/streaming-service" && npx tsc --noEmit -p tsconfig.json) && echo "OK  streaming tsc"
(cd "$DASH" && npx tsc --noEmit) && echo "OK  dashboard tsc"

if [[ "$fail" -ne 0 ]]; then
  echo "SMOKE FAILED"
  exit 1
fi
echo "SMOKE PASSED — deploy wallet migration, set ADMIN_API_TOKEN + SEASON_OPS_ALLOWED_EMAILS, create/start a season from dashboard."
