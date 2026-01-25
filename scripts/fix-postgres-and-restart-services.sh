#!/bin/bash

# Fix PostgreSQL Connection Limit and Restart Services
# This script restarts PostgreSQL and then restarts all services with connection limits

set -e

echo "=== Fixing PostgreSQL Connection Limit ==="
echo ""

# Step 1: Kill all services to free connections
echo "Step 1: Stopping all services..."
./scripts/cleanup-orphaned-processes.sh 2>&1 || true
sleep 2

# Step 2: Restart PostgreSQL
echo ""
echo "Step 2: Restarting PostgreSQL..."
if command -v brew >/dev/null 2>&1; then
    # Try common PostgreSQL versions
    brew services restart postgresql@14 2>&1 || \
    brew services restart postgresql@15 2>&1 || \
    brew services restart postgresql@16 2>&1 || \
    brew services restart postgresql 2>&1 || true
    echo "Waiting for PostgreSQL to start..."
    sleep 5
    
    # Verify PostgreSQL is running
    if pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
        echo "✓ PostgreSQL is running"
    else
        echo "⚠ PostgreSQL may still be starting. Waiting 5 more seconds..."
        sleep 5
    fi
else
    echo "⚠ Homebrew not found. Please restart PostgreSQL manually:"
    echo "  brew services restart postgresql@16"
    echo "  Or: sudo systemctl restart postgresql"
    read -p "Press Enter after PostgreSQL is restarted..."
fi

# Step 3: Restart all services
echo ""
echo "Step 3: Restarting all services with connection limits..."
ulimit -n 8192 2>/dev/null || true
./scripts/setup-and-start-services.sh

echo ""
echo "=== Done ==="
echo "Services should now be running with connection_limit=5 per service"
echo "This limits total connections to ~45 (9 services * 5), well under PostgreSQL default of 100"
