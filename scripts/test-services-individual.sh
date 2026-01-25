#!/bin/bash

# Individual Service Test Script
# Tests each service with verbose output to diagnose connection issues

set -e

echo "=== Individual Service Health Check ==="
echo ""

services=(
    "api-gateway:3000:/health"
    "auth-service:3001:/health"
    "user-service:3002:/health"
    "moderation-service:3003:/health"
    "discovery-service:3004:/health"
    "wallet-service:3005:/health"
    "streaming-service:3006:/health"
    "payment-service:3007:/v1/payments/health"
    "files-service:3008:/health"
    "friend-service:3009:/health"
)

for service_config in "${services[@]}"; do
    IFS=':' read -r name port endpoint <<< "$service_config"
    url="http://127.0.0.1:$port$endpoint"
    
    echo "Testing $name (port $port)..."
    echo "  URL: $url"
    
    # Check if port is listening
    if lsof -i :$port 2>/dev/null | grep -q LISTEN; then
        echo "  ✓ Port $port is listening"
    else
        echo "  ✗ Port $port is NOT listening"
        echo ""
        continue
    fi
    
    # Try curl with verbose output
    echo "  Attempting curl..."
    response=$(curl -v --ipv4 --max-time 10 "$url" 2>&1) || true
    
    if echo "$response" | grep -q "HTTP/1.1 200\|HTTP/2 200"; then
        echo "  ✓ Service responded with 200 OK"
        status=$(echo "$response" | grep -o '"status":"[^"]*"' | head -1 || echo "")
        if [ -n "$status" ]; then
            echo "  Status: $status"
        fi
    elif echo "$response" | grep -q "Connection refused\|Can't assign\|Failed to connect"; then
        echo "  ✗ Connection failed:"
        echo "$response" | grep -E "Connection refused|Can't assign|Failed to connect" | head -1
    elif echo "$response" | grep -q "timeout\|timed out"; then
        echo "  ✗ Request timed out"
    else
        echo "  ? Unexpected response:"
        echo "$response" | head -5
    fi
    echo ""
done

echo "=== Summary ==="
echo "If all services show 'Port is listening' but curl fails, there may be:"
echo "  1. Network/firewall blocking localhost connections"
echo "  2. Services binding to wrong interface"
echo "  3. Services hanging on health checks"
echo ""
echo "Check service logs: tail -f /tmp/<service-name>.log"
