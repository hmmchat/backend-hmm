#!/bin/bash
# Cleanup orphaned streaming sessions and participants
# This script marks old sessions as ENDED and marks participants as inactive

set -e

echo "🔍 Analyzing orphaned streaming data..."

PGPASSWORD=postgres psql -h localhost -U postgres -d hmm_streaming <<EOF
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
