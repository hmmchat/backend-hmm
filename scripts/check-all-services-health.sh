#!/bin/bash

# Complete Health Check Script for All Services
# This script checks all services with appropriate timeouts

set -euo pipefail

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}=== Service Health Check ===${NC}"
echo ""

passing=0
total=0

# Service definitions: name:port:endpoint:timeout
services=(
    "api-gateway:3000:/health:45"
    "auth-service:3001:/health:20"
    "user-service:3002:/health:40"
    "moderation-service:3003:/health:20"
    "discovery-service:3004:/health:40"
    "wallet-service:3005:/health:20"
    "streaming-service:3006:/health:40"
    "payment-service:3007:/v1/payments/health:30"
    "files-service:3008:/health:20"
    "friend-service:3009:/health:40"
)

for service_config in "${services[@]}"; do
    total=$((total + 1))
    IFS=':' read -r name port endpoint timeout <<< "$service_config"
    
    echo -n "Checking $name... "
    
    # Add small delay between checks to avoid thundering herd
    # Services with dependencies need time to recover between checks
    if [ $total -gt 1 ]; then
        sleep 0.5
    fi
    
    # Use IPv4 explicitly to avoid IPv6 connection issues
    if curl -s --ipv4 --max-time $timeout "http://127.0.0.1:$port$endpoint" >/dev/null 2>&1; then
        # Get status from response
        response=$(curl -s --ipv4 --max-time $timeout "http://127.0.0.1:$port$endpoint" 2>/dev/null || echo "")
        if [ -n "$response" ]; then
            status=$(echo "$response" | jq -r '.status // "healthy"' 2>/dev/null || echo "healthy")
        else
            status="healthy"
        fi
        echo -e "${GREEN}✓ $status${NC}"
        passing=$((passing + 1))
    else
        echo -e "${RED}✗ NOT RESPONDING${NC}"
    fi
done

echo ""
if [ $passing -eq $total ]; then
    echo -e "${GREEN}✅ All $total services passing health checks!${NC}"
    exit 0
else
    echo -e "${YELLOW}⚠️  $passing/$total services passing${NC}"
    exit 1
fi
