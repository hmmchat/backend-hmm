#!/bin/bash

# Wait for services to stabilize and then check health
# Use this after starting services to give them time to fully initialize

set -e

echo "=== Waiting for Services to Stabilize ==="
echo ""

# Wait 30 seconds for services to fully initialize
echo "Waiting 30 seconds for services to stabilize..."
for i in {30..1}; do
    echo -ne "\r  $i seconds remaining... "
    sleep 1
done
echo -e "\r  Ready! Checking services...     "

echo ""
echo "Running health check..."
echo ""

./scripts/check-all-services-health.sh
