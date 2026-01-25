#!/bin/bash

# Script to measure individual service startup times
# This helps determine optimal wait times for the main setup script

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Service Startup Time Measurement Tool               ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}"
echo ""

# Function to start a service and measure time
measure_service_startup() {
    local service_name=$1
    local port=$2
    local health_endpoint=$3
    local service_dir="$ROOT_DIR/apps/$service_name"
    
    echo -e "${CYAN}Testing: $service_name (port $port)${NC}"
    
    # Kill any existing process
    pkill -f "npm.*start:dev.*$service_name" 2>/dev/null || true
    pkill -f "node.*$service_name/dist/main" 2>/dev/null || true
    sleep 1
    
    # Kill port if in use
    local pids=$(lsof -ti:$port 2>/dev/null || echo "")
    if [ -n "$pids" ]; then
        for pid in $pids; do
            kill -9 $pid 2>/dev/null || true
        done
        sleep 1
    fi
    
    # Start timing
    local start_time=$(date +%s.%N)
    
    # Start service
    cd "$service_dir"
    
    # Get DATABASE_URL if needed
    local db_url=""
    if [ -f ".env" ] && grep -q "DATABASE_URL" .env 2>/dev/null; then
        db_url=$(grep "^DATABASE_URL=" .env | cut -d'=' -f2- | tr -d '"' | tr -d "'")
    elif [ -f ".env.test" ] && grep -q "DATABASE_URL" .env.test 2>/dev/null; then
        db_url=$(grep "^DATABASE_URL=" .env.test | cut -d'=' -f2- | tr -d '"' | tr -d "'")
    fi
    
    # Start service
    if [ -n "$db_url" ]; then
        nohup env TEST_MODE=true NODE_ENV=test PORT=$port DATABASE_URL="$db_url" npm run start:dev > "/tmp/${service_name}-timing.log" 2>&1 &
    else
        nohup env TEST_MODE=true NODE_ENV=test PORT=$port npm run start:dev > "/tmp/${service_name}-timing.log" 2>&1 &
    fi
    local npm_pid=$!
    cd "$ROOT_DIR"
    
    echo -e "  ${BLUE}Started (PID: $npm_pid), waiting for health check...${NC}"
    
    # Wait for service to be ready
    local max_wait=90
    local waited=0
    local service_ready=false
    
    while [ $waited -lt $max_wait ]; do
        sleep 2
        waited=$((waited + 2))
        
        # Check if process is still running
        if ! kill -0 $npm_pid 2>/dev/null; then
            echo -e "  ${RED}✗ Service process died${NC}"
            echo -e "  ${YELLOW}Check logs: tail -20 /tmp/${service_name}-timing.log${NC}"
            tail -20 "/tmp/${service_name}-timing.log" 2>/dev/null | sed 's/^/    /' || true
            return 1
        fi
        
        # Check health endpoint
        if curl -s -f --max-time 5 "http://localhost:${port}${health_endpoint}" >/dev/null 2>&1; then
            local end_time=$(date +%s.%N)
            local duration=$(echo "$end_time - $start_time" | bc)
            echo -e "  ${GREEN}✓ $service_name is UP after ${duration}s${NC}"
            service_ready=true
            break
        fi
        
        # Show progress every 10 seconds
        if [ $((waited % 10)) -eq 0 ]; then
            echo -e "    ${CYAN}Still waiting... (${waited}s/${max_wait}s)${NC}"
        fi
    done
    
    if [ "$service_ready" = false ]; then
        echo -e "  ${RED}✗ $service_name failed to start within ${max_wait}s${NC}"
        echo -e "  ${YELLOW}Check logs: tail -30 /tmp/${service_name}-timing.log${NC}"
        tail -30 "/tmp/${service_name}-timing.log" 2>/dev/null | sed 's/^/    /' || true
        return 1
    fi
    
    # Stop the service for next test
    kill $npm_pid 2>/dev/null || true
    pkill -f "node.*$service_name/dist/main" 2>/dev/null || true
    sleep 2
    
    return 0
}

# Service definitions with dependencies
declare -A service_times

echo -e "${BLUE}[1/4]${NC} Testing Tier 1 Services (No Dependencies)..."
echo ""

# Tier 1: No dependencies
tier1_services=(
    "auth-service:3001:/health"
    "moderation-service:3003:/health"
    "wallet-service:3005:/health"
    "files-service:3008:/health"
    "discovery-service:3004:/health"
)

for service_config in "${tier1_services[@]}"; do
    IFS=':' read -r name port endpoint <<< "$service_config"
    if measure_service_startup "$name" "$port" "$endpoint"; then
        # Extract time from output (we'll capture it differently)
        echo ""
    else
        echo -e "${RED}Failed to start $name${NC}"
        echo ""
    fi
    sleep 3
done

echo ""
echo -e "${BLUE}[2/4]${NC} Testing Tier 2 Services (Depend on Tier 1)..."
echo ""

# Start Tier 1 services first (they're dependencies)
echo -e "${CYAN}Starting Tier 1 dependencies...${NC}"
for service_config in "${tier1_services[@]}"; do
    IFS=':' read -r name port endpoint <<< "$service_config"
    cd "$ROOT_DIR/apps/$name"
    local db_url=""
    if [ -f ".env" ] && grep -q "DATABASE_URL" .env 2>/dev/null; then
        db_url=$(grep "^DATABASE_URL=" .env | cut -d'=' -f2- | tr -d '"' | tr -d "'")
    elif [ -f ".env.test" ] && grep -q "DATABASE_URL" .env.test 2>/dev/null; then
        db_url=$(grep "^DATABASE_URL=" .env.test | cut -d'=' -f2- | tr -d '"' | tr -d "'")
    fi
    if [ -n "$db_url" ]; then
        nohup env TEST_MODE=true NODE_ENV=test PORT=$port DATABASE_URL="$db_url" npm run start:dev > "/tmp/${name}.log" 2>&1 &
    else
        nohup env TEST_MODE=true NODE_ENV=test PORT=$port npm run start:dev > "/tmp/${name}.log" 2>&1 &
    fi
    cd "$ROOT_DIR"
done

echo "Waiting 15s for Tier 1 services to be ready..."
sleep 15

# Tier 2: Depend on Tier 1
tier2_services=(
    "user-service:3002:/health"
    "payment-service:3007:/v1/payments/health"
)

for service_config in "${tier2_services[@]}"; do
    IFS=':' read -r name port endpoint <<< "$service_config"
    if measure_service_startup "$name" "$port" "$endpoint"; then
        echo ""
    else
        echo -e "${RED}Failed to start $name${NC}"
        echo ""
    fi
    sleep 3
done

echo ""
echo -e "${BLUE}[3/4]${NC} Testing Tier 3 Services (Depend on Tier 2)..."
echo ""

# Start Tier 2 services
echo -e "${CYAN}Starting Tier 2 dependencies...${NC}"
for service_config in "${tier2_services[@]}"; do
    IFS=':' read -r name port endpoint <<< "$service_config"
    cd "$ROOT_DIR/apps/$name"
    local db_url=""
    if [ -f ".env" ] && grep -q "DATABASE_URL" .env 2>/dev/null; then
        db_url=$(grep "^DATABASE_URL=" .env | cut -d'=' -f2- | tr -d '"' | tr -d "'")
    elif [ -f ".env.test" ] && grep -q "DATABASE_URL" .env.test 2>/dev/null; then
        db_url=$(grep "^DATABASE_URL=" .env.test | cut -d'=' -f2- | tr -d '"' | tr -d "'")
    fi
    if [ -n "$db_url" ]; then
        nohup env TEST_MODE=true NODE_ENV=test PORT=$port DATABASE_URL="$db_url" npm run start:dev > "/tmp/${name}.log" 2>&1 &
    else
        nohup env TEST_MODE=true NODE_ENV=test PORT=$port npm run start:dev > "/tmp/${name}.log" 2>&1 &
    fi
    cd "$ROOT_DIR"
done

echo "Waiting 15s for Tier 2 services to be ready..."
sleep 15

# Tier 3: Depend on Tier 2
tier3_services=(
    "friend-service:3009:/health"
    "streaming-service:3006:/health"
)

for service_config in "${tier3_services[@]}"; do
    IFS=':' read -r name port endpoint <<< "$service_config"
    if measure_service_startup "$name" "$port" "$endpoint"; then
        echo ""
    else
        echo -e "${RED}Failed to start $name${NC}"
        echo ""
    fi
    sleep 3
done

echo ""
echo -e "${BLUE}[4/4]${NC} Testing Tier 4 Service (Depends on All)..."
echo ""

# Start Tier 3 services
echo -e "${CYAN}Starting Tier 3 dependencies...${NC}"
for service_config in "${tier3_services[@]}"; do
    IFS=':' read -r name port endpoint <<< "$service_config"
    cd "$ROOT_DIR/apps/$name"
    local db_url=""
    if [ -f ".env" ] && grep -q "DATABASE_URL" .env 2>/dev/null; then
        db_url=$(grep "^DATABASE_URL=" .env | cut -d'=' -f2- | tr -d '"' | tr -d "'")
    elif [ -f ".env.test" ] && grep -q "DATABASE_URL" .env.test 2>/dev/null; then
        db_url=$(grep "^DATABASE_URL=" .env.test | cut -d'=' -f2- | tr -d '"' | tr -d "'")
    fi
    if [ -n "$db_url" ]; then
        nohup env TEST_MODE=true NODE_ENV=test PORT=$port DATABASE_URL="$db_url" npm run start:dev > "/tmp/${name}.log" 2>&1 &
    else
        nohup env TEST_MODE=true NODE_ENV=test PORT=$port npm run start:dev > "/tmp/${name}.log" 2>&1 &
    fi
    cd "$ROOT_DIR"
done

echo "Waiting 20s for Tier 3 services to be ready..."
sleep 20

# Tier 4: Depends on all
tier4_services=(
    "api-gateway:3000:/health"
)

for service_config in "${tier4_services[@]}"; do
    IFS=':' read -r name port endpoint <<< "$service_config"
    if measure_service_startup "$name" "$port" "$endpoint"; then
        echo ""
    else
        echo -e "${RED}Failed to start $name${NC}"
        echo ""
    fi
done

# Cleanup
echo ""
echo -e "${CYAN}Cleaning up test services...${NC}"
pkill -f "npm.*start:dev" 2>/dev/null || true
pkill -f "node.*dist/main" 2>/dev/null || true
sleep 2

echo ""
echo -e "${GREEN}✓ Startup time measurement complete!${NC}"
echo ""
echo -e "${CYAN}Summary:${NC}"
echo "Check the output above for individual service startup times."
echo "Use these times to configure appropriate wait periods in the main setup script."
