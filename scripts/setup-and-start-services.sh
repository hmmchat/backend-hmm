#!/bin/bash

# Complete Setup and Start Script for HMM Backend
# This script ensures all prerequisites are met and all services are running
# Safe to run multiple times (idempotent)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Function to get service port and health endpoint (compatible with older bash)
get_service_config() {
    local service_name=$1
    case "$service_name" in
        "api-gateway")
            echo "3000:/health"
            ;;
        "auth-service")
            echo "3001:/health"
            ;;
        "user-service")
            echo "3002:/health"
            ;;
        "moderation-service")
            echo "3003:/health"
            ;;
        "discovery-service")
            echo "3004:/health"
            ;;
        "streaming-service")
            echo "3005:/streaming/health"
            ;;
        "wallet-service")
            echo "3006:/health"
            ;;
        "payment-service")
            echo "3007:/health"
            ;;
        "files-service")
            echo "3008:/health"
            ;;
        "friend-service")
            echo "3009:/health"
            ;;
        *)
            echo ""
            ;;
    esac
}

echo -e "${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     HMM Backend - Complete Setup & Start Script      ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}\n"

# Function to check if a port is in use
check_port() {
    local port=$1
    if lsof -ti:$port >/dev/null 2>&1; then
        return 0  # Port is in use
    else
        return 1  # Port is free
    fi
}

# Function to kill process on a port
kill_port() {
    local port=$1
    local pid=$(lsof -ti:$port 2>/dev/null || echo "")
    if [ -n "$pid" ]; then
        echo -e "    ${YELLOW}⚠${NC} Port $port is in use (PID: $pid), killing..."
        kill -9 $pid 2>/dev/null || true
        sleep 1
    fi
}

# Function to check if PostgreSQL is running
check_postgresql() {
    echo -e "${BLUE}[1/6]${NC} Checking PostgreSQL..."
    if command -v pg_isready >/dev/null 2>&1; then
        if pg_isready >/dev/null 2>&1; then
            echo -e "${GREEN}✓${NC} PostgreSQL is running"
            return 0
        else
            echo -e "${RED}✗${NC} PostgreSQL is not running"
            echo -e "${YELLOW}  ${NC}Please start PostgreSQL first:"
            echo -e "${YELLOW}    ${NC}macOS: brew services start postgresql"
            echo -e "${YELLOW}    ${NC}Linux: sudo systemctl start postgresql"
            return 1
        fi
    else
        echo -e "${YELLOW}⚠${NC} pg_isready not found. Skipping PostgreSQL check."
        echo -e "${YELLOW}  ${NC}Please ensure PostgreSQL is running."
        return 0
    fi
}

# Function to check if Redis is running (optional)
check_redis() {
    echo -e "${BLUE}[2/6]${NC} Checking Redis (optional)..."
    if command -v redis-cli >/dev/null 2>&1; then
        if redis-cli ping >/dev/null 2>&1; then
            echo -e "${GREEN}✓${NC} Redis is running"
        else
            echo -e "${YELLOW}⚠${NC} Redis is not running (optional, continuing anyway)"
            echo -e "${YELLOW}  ${NC}To start Redis: brew services start redis"
        fi
    else
        echo -e "${YELLOW}⚠${NC} redis-cli not found. Skipping Redis check."
    fi
}

# Function to setup Prisma for a service
setup_service_prisma() {
    local service_name=$1
    local service_dir="$ROOT_DIR/apps/$service_name"
    local schema_file="$service_dir/prisma/schema.prisma"
    
    if [ ! -f "$schema_file" ]; then
        return 0  # No schema, skip silently
    fi
    
    cd "$service_dir"
    
    # Check if .env exists
    if [ ! -f ".env" ]; then
        echo -e "    ${YELLOW}⚠${NC} .env file not found for $service_name (skipping Prisma setup)"
        return 0
    fi
    
    # Check if DATABASE_URL is set in .env
    if ! grep -q "DATABASE_URL" .env 2>/dev/null; then
        echo -e "    ${YELLOW}⚠${NC} DATABASE_URL not found in .env for $service_name (skipping Prisma setup)"
        return 0
    fi
    
    # Generate Prisma client
    npx prisma generate >/dev/null 2>&1 || true
    
    # Sync database schema
    npx prisma db push --accept-data-loss >/dev/null 2>&1 || true
    
    # Regenerate client after sync
    npx prisma generate >/dev/null 2>&1 || true
    
    return 0
}

# Function to build a service
build_service() {
    local service_name=$1
    local service_dir="$ROOT_DIR/apps/$service_name"
    
    if [ ! -f "$service_dir/package.json" ]; then
        return 1
    fi
    
    cd "$service_dir"
    
    # Check if dist exists and is recent, if not build
    if [ ! -d "dist" ] || [ "src" -nt "dist" ]; then
        echo -e "    ${BLUE}→${NC} Building $service_name..."
        npm run build >/dev/null 2>&1 || return 1
    fi
    
    return 0
}

# Function to check if a service is running
check_service_running() {
    local service_name=$1
    local port=$2
    local health_endpoint=$3
    
    if ! check_port $port; then
        return 1  # Not running
    fi
    
    # Try to hit health endpoint
    local url="http://localhost:${port}${health_endpoint}"
    if curl -s -f "$url" >/dev/null 2>&1; then
        return 0  # Running and healthy
    else
        return 2  # Port in use but not responding (might be wrong service)
    fi
}

# Function to start a service
start_service() {
    local service_name=$1
    local port=$2
    local service_dir="$ROOT_DIR/apps/$service_name"
    
    cd "$service_dir"
    
    # Kill any existing process on the port
    kill_port $port
    
    # Build if needed
    if ! build_service "$service_name"; then
        echo -e "    ${RED}✗${NC} Failed to build $service_name"
        return 1
    fi
    
    # Start service in background
    echo -e "    ${BLUE}→${NC} Starting $service_name on port $port..."
    npm start > "/tmp/${service_name}.log" 2>&1 &
    local pid=$!
    
    # Wait a bit for service to start
    sleep 2
    
    # Check if process is still running
    if ! kill -0 $pid 2>/dev/null; then
        echo -e "    ${RED}✗${NC} Service failed to start. Check /tmp/${service_name}.log"
        return 1
    fi
    
    echo -e "    ${GREEN}✓${NC} $service_name started (PID: $pid)"
    echo -e "    ${CYAN}  ${NC}Logs: tail -f /tmp/${service_name}.log"
    
    return 0
}

# Main execution
main() {
    # Step 1: Check infrastructure
    check_postgresql || {
        echo -e "\n${RED}Error:${NC} PostgreSQL is required. Please start PostgreSQL and run this script again."
        exit 1
    }
    
    check_redis
    
    # Step 2: Setup Prisma
    echo -e "\n${BLUE}[3/6]${NC} Setting up Prisma for all services..."
    
    services_with_prisma=(
        "auth-service"
        "discovery-service"
        "user-service"
        "streaming-service"
        "wallet-service"
        "files-service"
        "payment-service"
        "friend-service"
    )
    
    for service in "${services_with_prisma[@]}"; do
        setup_service_prisma "$service" || true
    done
    
    echo -e "${GREEN}✓${NC} Prisma setup complete"
    
    # Step 3: Check and start services
    echo -e "\n${BLUE}[4/6]${NC} Checking and starting services..."
    
    # Order matters - start dependencies first
    service_order=(
        "auth-service"
        "user-service"
        "moderation-service"
        "discovery-service"
        "streaming-service"
        "wallet-service"
        "payment-service"
        "files-service"
        "friend-service"
        "api-gateway"
    )
    
    local failed_services=()
    
    for service in "${service_order[@]}"; do
        local service_config=$(get_service_config "$service")
        if [ -z "$service_config" ]; then
            continue
        fi
        
        IFS=':' read -r port health_endpoint <<< "$service_config"
        
        echo -e "\n${CYAN}Checking: $service${NC}"
        
        check_service_running "$service" "$port" "$health_endpoint"
        local status=$?
        
        case $status in
            0)
                echo -e "  ${GREEN}✓${NC} $service is running and healthy on port $port"
                ;;
            1)
                echo -e "  ${YELLOW}⚠${NC} $service is not running"
                if ! start_service "$service" "$port"; then
                    failed_services+=("$service")
                fi
                ;;
            2)
                echo -e "  ${YELLOW}⚠${NC} Port $port is in use but service not responding"
                echo -e "  ${YELLOW}  ${NC}Killing process on port $port and restarting..."
                kill_port "$port"
                if ! start_service "$service" "$port"; then
                    failed_services+=("$service")
                fi
                ;;
        esac
    done
    
    # Step 4: Wait for services to be ready
    echo -e "\n${BLUE}[5/6]${NC} Waiting for services to be ready..."
    sleep 3
    
    # Step 5: Verify all services
    echo -e "\n${BLUE}[6/6]${NC} Verifying services..."
    
    local all_healthy=true
    
    for service in "${service_order[@]}"; do
        local service_config=$(get_service_config "$service")
        if [ -z "$service_config" ]; then
            continue
        fi
        
        IFS=':' read -r port health_endpoint <<< "$service_config"
        
        if check_service_running "$service" "$port" "$health_endpoint"; then
            echo -e "  ${GREEN}✓${NC} $service (port $port)"
        else
            echo -e "  ${RED}✗${NC} $service (port $port) - not responding"
            all_healthy=false
            failed_services+=("$service")
        fi
    done
    
    # Final summary
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}Summary${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    
    if [ ${#failed_services[@]} -eq 0 ] && [ "$all_healthy" = true ]; then
        echo -e "${GREEN}✓ All services are running and healthy!${NC}\n"
        echo -e "${GREEN}Services available at:${NC}"
        echo -e "  ${CYAN}API Gateway:${NC} http://localhost:3000"
        echo -e "  ${CYAN}Auth:${NC}        http://localhost:3001"
        echo -e "  ${CYAN}User:${NC}        http://localhost:3002"
        echo -e "  ${CYAN}Moderation:${NC}  http://localhost:3003"
        echo -e "  ${CYAN}Discovery:${NC}   http://localhost:3004"
        echo -e "  ${CYAN}Streaming:${NC}   http://localhost:3005"
        echo -e "  ${CYAN}Wallet:${NC}      http://localhost:3006"
        echo -e "  ${CYAN}Payment:${NC}     http://localhost:3007"
        echo -e "  ${CYAN}Files:${NC}       http://localhost:3008"
        echo -e "  ${CYAN}Friend:${NC}      http://localhost:3009\n"
        echo -e "${GREEN}You can now:${NC}"
        echo -e "  1. Open the HTML test interface"
        echo -e "  2. Begin testing\n"
        echo -e "${CYAN}To view service logs:${NC}"
        echo -e "  tail -f /tmp/<service-name>.log\n"
        return 0
    else
        echo -e "${YELLOW}⚠ Some services had issues:${NC}"
        for service in "${failed_services[@]}"; do
            echo -e "  ${RED}✗${NC} $service"
            echo -e "    ${CYAN}Check logs:${NC} tail -f /tmp/${service}.log"
        done
        echo -e "\n${YELLOW}Please check the errors above and fix them.${NC}"
        echo -e "${YELLOW}Services may still be starting - wait a few seconds and check again.${NC}"
        return 1
    fi
}

# Run main function
main "$@"
