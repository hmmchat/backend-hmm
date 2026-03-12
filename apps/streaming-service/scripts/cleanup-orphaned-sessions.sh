#!/bin/bash
# Cleanup orphaned streaming sessions and participants
# This script marks old sessions as ENDED and marks participants as inactive

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$SERVICE_DIR"

# Use DATABASE_URL from .env if set, otherwise fallback to streaming-service for local dev
if [ -f ".env" ] && grep -q "^DATABASE_URL=" .env 2>/dev/null; then
  DATABASE_URL=$(grep "^DATABASE_URL=" .env | cut -d'=' -f2- | tr -d '"' | tr -d "'")
fi

DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/streaming-service?schema=public}"

echo "🔍 Analyzing orphaned streaming data..."

psql "$DATABASE_URL" <<EOF
-- Show current state
SELECT 
  'Before cleanup' as status,
  COUNT(*) FILTER (WHERE status != 'ENDED') as active_sessions,
  COUNT(*) FILTER (WHERE status = 'ENDED') as ended_sessions,
  (SELECT COUNT(*) FROM call_participants WHERE status = 'active' AND "leftAt" IS NULL) as active_participants
FROM call_sessions;

-- Mark sessions older than 1 day as ENDED if they're still active
UPDATE call_sessions
SET 
  status = 'ENDED',
  "endedAt" = COALESCE("endedAt", NOW()),
  "isBroadcasting" = false
WHERE 
  status != 'ENDED' 
  AND "startedAt" < NOW() - INTERVAL '1 day';

-- Mark participants in ENDED sessions as inactive
UPDATE call_participants
SET 
  status = 'inactive',
  "leftAt" = COALESCE("leftAt", NOW())
WHERE 
  status = 'active' 
  AND "leftAt" IS NULL
  AND "sessionId" IN (
    SELECT id FROM call_sessions WHERE status = 'ENDED'
  );

-- Mark viewers in ENDED sessions as left
UPDATE call_viewers
SET 
  "leftAt" = COALESCE("leftAt", NOW())
WHERE 
  "leftAt" IS NULL
  AND "sessionId" IN (
    SELECT id FROM call_sessions WHERE status = 'ENDED'
  );

-- Show results
SELECT 
  'After cleanup' as status,
  COUNT(*) FILTER (WHERE status != 'ENDED') as active_sessions,
  COUNT(*) FILTER (WHERE status = 'ENDED') as ended_sessions,
  (SELECT COUNT(*) FROM call_participants WHERE status = 'active' AND "leftAt" IS NULL) as active_participants
FROM call_sessions;
EOF

echo "✅ Cleanup completed"
