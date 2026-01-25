#!/bin/bash

# Kill idle PostgreSQL connections to free up connection slots
# This is a quick fix when hitting "too many clients" error

set -e

echo "=== Killing Idle PostgreSQL Connections ==="
echo ""

# Try to connect and kill idle connections
# Use a single connection to do the work
psql -h localhost -p 5432 -U postgres -d postgres <<EOF 2>&1 || true
SELECT pg_terminate_backend(pid) 
FROM pg_stat_activity 
WHERE state = 'idle' 
  AND state_change < now() - interval '5 minutes'
  AND pid <> pg_backend_pid();
EOF

echo ""
echo "✓ Attempted to kill idle connections"
echo ""
echo "If you still see 'too many clients', try:"
echo "  1. Restart PostgreSQL: brew services restart postgresql@16"
echo "  2. Or increase max_connections in postgresql.conf"
