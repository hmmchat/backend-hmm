#!/bin/bash

# Fix PostgreSQL Connection Limit Issue
# This script checks connection count and provides solutions

set -e

echo "=== PostgreSQL Connection Diagnostic ==="
echo ""

# Try to connect and check connections
if psql -h localhost -p 5432 -U postgres -d postgres -c "SELECT count(*) as current, (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') as max FROM pg_stat_activity WHERE datname IS NOT NULL;" 2>&1 | grep -q "too many clients"; then
    echo "❌ Cannot connect - PostgreSQL is at max_connections limit"
    echo ""
    echo "Solutions:"
    echo ""
    echo "1. Increase max_connections (recommended for development):"
    echo "   Edit PostgreSQL config (usually /opt/homebrew/var/postgresql@16/postgresql.conf or /usr/local/var/postgres/postgresql.conf)"
    echo "   Set: max_connections = 200"
    echo "   Then restart PostgreSQL: brew services restart postgresql@16"
    echo ""
    echo "2. Kill idle connections (quick fix):"
    echo "   Run: psql -h localhost -p 5432 -U postgres -d postgres -c \"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle' AND pid <> pg_backend_pid();\""
    echo ""
    echo "3. Restart PostgreSQL (will disconnect all services):"
    echo "   brew services restart postgresql@16"
    echo ""
    echo "4. Restart all services (they will reconnect):"
    echo "   ./scripts/cleanup-orphaned-processes.sh"
    echo "   ./scripts/setup-and-start-services.sh"
    exit 1
else
    # Try to get connection info
    result=$(psql -h localhost -p 5432 -U postgres -d postgres -t -c "SELECT count(*) as current, (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') as max FROM pg_stat_activity WHERE datname IS NOT NULL;" 2>&1)
    if [ $? -eq 0 ]; then
        echo "$result" | awk '{print "Current connections: " $1 " / Max: " $2}'
        echo ""
        echo "✓ PostgreSQL has available connections"
    else
        echo "⚠ Could not check connection count, but PostgreSQL is accessible"
    fi
fi
