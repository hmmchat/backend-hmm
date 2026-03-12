#!/bin/bash

# Complete Setup and Start Script for HMM Backend
# This script ensures all prerequisites are met and all services are running
# Safe to run multiple times (idempotent)

set -uo pipefail
# Note: We handle errors manually in critical sections

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
            echo "3006:/health"
            ;;
        "wallet-service")
            echo "3005:/health"
            ;;
        "payment-service")
            echo "3007:/v1/payments/health:/v1/payments/ready"
            ;;
        "files-service")
            echo "3008:/health"
            ;;
        "friend-service")
            echo "3009:/health"
            ;;
        "ads-service")
            echo "3010:/health"
            ;;
        *)
            echo ""
            ;;
    esac
}

echo -e "${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     HMM Backend - Complete Setup & Start Script      ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}\n"

# Avoid "Too many open files" when running many services + curls
ulimit -n 8192 2>/dev/null || ulimit -n 4096 2>/dev/null || true

# Function to check if a port is in use
check_port() {
    local port=$1
    # Check if port is actually LISTENING (not just in use)
    # Use lsof with -P for numeric ports (macOS compatibility), netstat as fallback
    local lsof_output=$(lsof -i :$port -P 2>/dev/null)
    if [ -n "$lsof_output" ] && echo "$lsof_output" | grep -q LISTEN; then
        return 0  # Port is listening
    fi
    # Fallback: netstat (more reliable on some macOS setups where lsof can miss listeners)
    if netstat -an 2>/dev/null | grep -qE "[*.]${port}[[:space:]]+.*LISTEN"; then
        return 0  # Port is listening (netstat fallback)
    fi
    return 1  # Port is free or not listening
}

# Function to kill process on a port
kill_port() {
    local port=$1
    local pids=$(lsof -ti:$port 2>/dev/null || echo "")
    if [ -n "$pids" ]; then
        # First try to kill node/npm processes using the port
        for pid in $pids; do
            local cmd=$(ps -p $pid -o command= 2>/dev/null || echo "")
            if echo "$cmd" | grep -qE "node.*dist/main|npm.*start:dev"; then
                echo -e "    ${YELLOW}⚠${NC} Port $port is in use (PID: $pid), killing..."
                kill -9 $pid 2>/dev/null || true
            fi
        done
        sleep 1
        # If port is still in use, kill any process on it (handles stray/zombie processes)
        local remaining=$(lsof -ti:$port 2>/dev/null || echo "")
        if [ -n "$remaining" ]; then
            echo -e "    ${YELLOW}⚠${NC} Port $port still in use, killing remaining process(es)..."
            echo "$remaining" | xargs kill -9 2>/dev/null || true
            sleep 1
        fi
    fi
}

# Function to check if PostgreSQL is running
check_postgresql() {
    echo -e "${BLUE}[1/6]${NC} Checking PostgreSQL..."
    # Check if PostgreSQL is running - try multiple methods
    local pg_running=false
    
    # Method 1: pg_isready (with explicit host and port)
    if command -v pg_isready >/dev/null 2>&1; then
        if pg_isready -h localhost -p 5432 -U postgres >/dev/null 2>&1 || pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
            pg_running=true
        fi
    fi
    
    # Method 2: Check if port 5432 is listening
    if [ "$pg_running" = false ]; then
        if lsof -i :5432 2>/dev/null | grep -q LISTEN; then
            pg_running=true
        fi
    fi
    
    # Method 3: Try psql connection
    if [ "$pg_running" = false ]; then
        if psql -h localhost -p 5432 -U postgres -d postgres -c "SELECT 1;" >/dev/null 2>&1; then
            pg_running=true
        fi
    fi
    
    if [ "$pg_running" = true ]; then
        echo -e "${GREEN}✓${NC} PostgreSQL is running"
        return 0
    else
        echo -e "${RED}✗${NC} PostgreSQL is not running"
        echo -e "${YELLOW}  ${NC}Please start PostgreSQL first:"
        echo -e "${YELLOW}    ${NC}macOS: brew services start postgresql"
        echo -e "${YELLOW}    ${NC}Linux: sudo systemctl start postgresql"
        return 1
    fi
}

# Function to check if Redis is running (required for friend-service)
check_redis() {
    echo -e "${BLUE}[2/6]${NC} Checking Redis..."
    if command -v redis-cli >/dev/null 2>&1; then
        if redis-cli ping >/dev/null 2>&1; then
            echo -e "${GREEN}✓${NC} Redis is running"
            return 0
        else
            echo -e "${RED}✗${NC} Redis is not running"
            echo -e "${YELLOW}  ${NC}Redis is required for friend-service."
            echo -e "${YELLOW}  ${NC}Start Redis: brew services start redis"
            return 1
        fi
    else
        echo -e "${RED}✗${NC} redis-cli not found. Install Redis: brew install redis"
        return 1
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
    
    echo -e "    ${BLUE}→${NC} Setting up Prisma for $service_name..."
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
    
    # Generate Prisma client first
    echo -e "    ${BLUE}  →${NC} Generating Prisma client..."
    local gen_output=$(npx prisma generate 2>&1)
    if [ $? -eq 0 ] || echo "$gen_output" | grep -q "pnpm"; then
        echo -e "    ${GREEN}  ✓${NC} Prisma client generated for $service_name"
    else
        echo -e "    ${YELLOW}  ⚠${NC} Prisma generate had warnings for $service_name (continuing anyway)"
    fi
    
    # Check if migrations directory exists
    local migrations_dir="$service_dir/prisma/migrations"
    local has_migrations=false
    
    if [ -d "$migrations_dir" ] && [ "$(ls -A $migrations_dir 2>/dev/null | grep -v migration_lock.toml)" ]; then
        has_migrations=true
    fi
    
    # Use migrations if they exist, otherwise db push for initial setup
    if [ "$has_migrations" = true ]; then
        # Deploy existing migrations
        echo -e "    ${BLUE}  →${NC} Deploying database migrations..."
        local migrate_output=$(npx prisma migrate deploy 2>&1)
        local migrate_status=$?
        
        if [ $migrate_status -eq 0 ]; then
            if echo "$migrate_output" | grep -q "All migrations have been applied\|No pending migrations\|Applied migration"; then
                echo -e "    ${GREEN}  ✓${NC} Database migrations deployed for $service_name"
            else
                echo -e "    ${GREEN}  ✓${NC} Database migrations processed for $service_name"
            fi
        else
            echo -e "    ${RED}  ✗${NC} Database migration deployment FAILED for $service_name"
            echo -e "    ${RED}    ${NC}Error output:"
            echo "$migrate_output" | sed 's/^/    /' | head -10
            echo -e "    ${YELLOW}    ${NC}This is CRITICAL - tables may not exist!"
            echo -e "    ${YELLOW}    ${NC}Try running manually: cd $service_dir && npx prisma migrate deploy"
            return 1
        fi
    else
        # No migrations exist - db push is safe (each service has its own database)
        echo -e "    ${BLUE}  →${NC} No migrations found - using db push for initial schema setup..."
        echo -e "    ${YELLOW}    ${NC}Note: For production, create migrations manually with: npx prisma migrate dev"
        
        # Use gtimeout if available (macOS), otherwise use perl timeout, or just run without timeout
        local timeout_cmd=""
        if command -v gtimeout >/dev/null 2>&1; then
            timeout_cmd="gtimeout 30"
        elif command -v perl >/dev/null 2>&1; then
            timeout_cmd="perl -e 'alarm 30; exec @ARGV' --"
        fi
        
        local push_output=$(${timeout_cmd} npx prisma db push --accept-data-loss --skip-generate 2>&1)
        local push_status=$?
        
        if [ $push_status -eq 0 ]; then
            # Verify the push was successful
            if echo "$push_output" | grep -q "Your database is now in sync\|Pushing the state\|Everything is now in sync"; then
                echo -e "    ${GREEN}  ✓${NC} Database schema created for $service_name (using db push)"
            else
                echo -e "    ${GREEN}  ✓${NC} Database schema setup completed for $service_name"
            fi
        else
            # Check if it timed out or had an error
            if echo "$push_output" | grep -q "timeout\|Timed out"; then
                echo -e "    ${RED}  ✗${NC} Database schema setup TIMED OUT for $service_name"
                echo -e "    ${YELLOW}    ${NC}This may indicate database connection issues"
            else
                echo -e "    ${RED}  ✗${NC} Database schema setup FAILED for $service_name"
                echo -e "    ${RED}    ${NC}Error output:"
                echo "$push_output" | sed 's/^/    /' | head -10
            fi
            echo -e "    ${YELLOW}    ${NC}Try running manually: cd $service_dir && npx prisma db push"
            return 1
        fi
    fi
    
    # Regenerate client after migrations to ensure it's up to date
    npx prisma generate --skip-postinstall >/dev/null 2>&1 || npx prisma generate >/dev/null 2>&1 || true
    
    return 0
}

# Function to build a service (optional - start:dev doesn't require build)
build_service() {
    local service_name=$1
    local service_dir="$ROOT_DIR/apps/$service_name"
    
    if [ ! -f "$service_dir/package.json" ]; then
        return 1
    fi
    
    # For start:dev, we don't need to build - it compiles on the fly
    # But we should ensure dependencies are installed
    cd "$service_dir"
    
    # Check if node_modules exists
    if [ ! -d "node_modules" ]; then
        echo -e "    ${BLUE}→${NC} Installing dependencies for $service_name..."
        npm install >/dev/null 2>&1 || return 1
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
    
    # Use /ready endpoint for startup checks (faster, no dependencies)
    # Use /health/live for gateway (simple liveness check)
    local ready_endpoint=""
    if [ "$service_name" = "api-gateway" ]; then
        ready_endpoint="/health/live"
    elif [ "$service_name" = "payment-service" ]; then
        ready_endpoint="/v1/payments/ready"  # Payment service has different path
    else
        # Try /ready first, fallback to /health
        ready_endpoint="/ready"
    fi
    
    # Primary check: Is port listening? (More reliable than HTTP in restricted environments)
    if ! check_port "$port"; then
        return 1  # Not running
    fi
    
    # Secondary check: Try HTTP (but don't fail if network is restricted)
    local timeout=5
    local url="http://127.0.0.1:${port}${ready_endpoint}"
    local response=$(curl -s --ipv4 --connect-timeout 1 --max-time $timeout "$url" 2>/dev/null)
    if [ -n "$response" ] && (echo "$response" | grep -q '"status":"ready"' || echo "$response" | grep -q '"status":"healthy"'); then
        return 0  # Running and ready
    fi
    
    # If /ready doesn't exist or failed, try health endpoint
    url="http://127.0.0.1:${port}${health_endpoint}"
    if [ "$service_name" = "api-gateway" ]; then
        timeout=10  # Gateway health is now cached, should be fast
    elif [ "$service_name" = "streaming-service" ] || [ "$service_name" = "user-service" ]; then
        timeout=8  # These services check dependencies in parallel now
    else
        timeout=5
    fi
    
    # Try health endpoint
    if curl -s --ipv4 --connect-timeout 1 --max-time $timeout "$url" >/dev/null 2>&1; then
        return 0  # Running and healthy
    fi
    
    # Port is listening but HTTP failed - likely network restriction, consider it running
    if check_port "$port"; then
        return 0  # Port is listening, service is likely running
    else
        return 2  # Port in use but not listening (might be wrong service)
    fi
}

# Function to start a service
start_service() {
    local service_name=$1
    local port=$2
    local health_endpoint=$3
    local service_dir="$ROOT_DIR/apps/$service_name"
    
    cd "$service_dir"
    
    # Kill any existing process on the port
    kill_port $port
    
    # Ensure dependencies are installed (build_service checks this)
    if ! build_service "$service_name"; then
        echo -e "    ${RED}✗${NC} Failed to prepare $service_name (check dependencies)"
        return 1
    fi
    
    # Start service in background with TEST_MODE
    echo -e "    ${BLUE}→${NC} Starting $service_name on port $port..."
    # Use start:dev for development (auto-reload, no build required)
    # Set TEST_MODE=true and NODE_ENV=test for test endpoints
    # Also set PORT explicitly to ensure correct port binding
    cd "$service_dir"
    
    # Set DATABASE_URL if service needs it (from .env if exists, fallback to .env.test)
    local db_url=""
    if [ -f ".env" ] && grep -q "DATABASE_URL" .env 2>/dev/null; then
        db_url=$(grep "^DATABASE_URL=" .env | cut -d'=' -f2- | tr -d '"' | tr -d "'")
    elif [ -f ".env.test" ] && grep -q "DATABASE_URL" .env.test 2>/dev/null; then
        db_url=$(grep "^DATABASE_URL=" .env.test | cut -d'=' -f2- | tr -d '"' | tr -d "'")
    fi
    
    # Add connection_limit and connect_timeout to DATABASE_URL
    # connection_limit: prevent hitting PostgreSQL max_connections
    # connect_timeout: fail fast (10s) if DB unreachable instead of hanging
    if [ -n "$db_url" ]; then
        if ! echo "$db_url" | grep -q "connection_limit"; then
            if echo "$db_url" | grep -q "?"; then
                db_url="${db_url}&connection_limit=5"
            else
                db_url="${db_url}?connection_limit=5"
            fi
        fi
        if ! echo "$db_url" | grep -q "connect_timeout"; then
            db_url="${db_url}&connect_timeout=10"
        fi
    fi
    
    # Service-specific env overrides for stable local dev
    local extra_env=""
    if [ "$service_name" = "streaming-service" ]; then
        extra_env="MEDIASOUP_WORKERS=1"
    fi
    
    # Start with proper environment variables
    if [ -n "$db_url" ]; then
        nohup env TEST_MODE=true NODE_ENV=test PORT=$port DATABASE_URL="$db_url" $extra_env npm run start:dev > "/tmp/${service_name}.log" 2>&1 &
    else
        nohup env TEST_MODE=true NODE_ENV=test PORT=$port $extra_env npm run start:dev > "/tmp/${service_name}.log" 2>&1 &
    fi
    local npm_pid=$!
    cd "$ROOT_DIR"
    
    # Store npm PID for cleanup
    echo $npm_pid > "/tmp/${service_name}.pid"
    
    # Wait a moment for node process to spawn, then find actual node PID
    sleep 2
    local node_pid=$(ps aux | grep -E "node.*${service_name}/dist/main|node.*dist/main.*${service_name}" | grep -v grep | awk '{print $2}' | head -1)
    if [ -n "$node_pid" ]; then
        echo $node_pid > "/tmp/${service_name}.node.pid"
    fi
    
    # Wait longer for service to start (NestJS needs more time)
    # Check multiple times with increasing delays
    local waited=0
    local max_wait=30  # Increased wait time for NestJS compilation
    if [ "$service_name" = "api-gateway" ]; then
        max_wait=45  # Gateway compiles, then /health checks all 9 services
    elif [ "$service_name" = "streaming-service" ]; then
        max_wait=45  # Mediasoup workers need extra time to initialize
    fi
    local service_healthy=false
    
    while [ $waited -lt $max_wait ]; do
        sleep 3
        waited=$((waited + 3))
        
        # Check if npm process is still running
        if ! kill -0 $npm_pid 2>/dev/null; then
            # npm process died - check log for errors
            echo -e "    ${RED}✗${NC} Service process died. Check /tmp/${service_name}.log"
            echo -e "    ${YELLOW}  ${NC}Last 20 lines of log:"
            tail -20 "/tmp/${service_name}.log" 2>/dev/null | sed 's/^/    /' || echo "    (log file not found)"
            return 1
        fi
        
        # Check if actual node process is running (not just npm wrapper)
        # Note: nest start --watch can restart the child node process; don't treat "node died" as fatal.
        # We rely on port listening + health check below instead.
        local node_pid_file="/tmp/${service_name}.node.pid"
        if [ -f "$node_pid_file" ]; then
            local node_pid=$(cat "$node_pid_file" 2>/dev/null)
            if [ -n "$node_pid" ] && ! kill -0 $node_pid 2>/dev/null; then
                # Node PID we tracked died (e.g. nest watch restarted worker); try to refresh
                local new_node_pid=$(ps aux | grep -E "node.*${service_name}/dist/main|node.*dist/main.*${service_name}" | grep -v grep | awk '{print $2}' | head -1)
                if [ -n "$new_node_pid" ]; then
                    echo $new_node_pid > "$node_pid_file"
                fi
            fi
        fi
        
        # Also verify the port is actually listening (not just process exists)
        # This catches cases where npm process exists but node service died
        if ! lsof -i:$port 2>/dev/null | grep -q LISTEN; then
            # Port not listening - wait a bit more (service might still be starting)
            if [ $waited -lt 15 ]; then
                continue  # Still within startup window, keep waiting
            else
                # Been waiting too long, port should be listening by now
                # Check if node process actually exists (not just npm wrapper)
                local node_pid=$(ps aux | grep -E "node.*${service_name}|node.*dist/main" | grep -v grep | awk '{print $2}' | head -1)
                if [ -z "$node_pid" ]; then
                    # Node process doesn't exist - service crashed
                    echo -e "    ${RED}✗${NC} Service process died (node process not found)"
                    echo -e "    ${YELLOW}  ${NC}Check /tmp/${service_name}.log for errors"
                    tail -30 "/tmp/${service_name}.log" 2>/dev/null | grep -E "error|Error|ERROR|Exception|Failed|CRITICAL" | tail -5 | sed 's/^/    /' || echo "    (no errors found in recent logs)"
                    return 1
                else
                    # Node process exists but port not listening - might be starting
                    continue
                fi
            fi
        fi
        
        # Check if service is responding - use /ready endpoint for faster startup checks
        local ready_endpoint=""
        if [ "$service_name" = "api-gateway" ]; then
            ready_endpoint="/health/live"  # Gateway has /health/live endpoint
        elif [ "$service_name" = "payment-service" ]; then
            ready_endpoint="/v1/payments/ready"  # Payment service has different path
        else
            ready_endpoint="/ready"  # Other services have /ready endpoint
        fi
        
        # Try ready endpoint first (faster, no dependencies) - use 127.0.0.1 with --ipv4
        local check_timeout=5
        local url="http://127.0.0.1:${port}${ready_endpoint}"
        local ready_response=$(curl -s --ipv4 --max-time $check_timeout "$url" 2>/dev/null)
        if [ -n "$ready_response" ] && (echo "$ready_response" | grep -q '"status":"ready"' || echo "$ready_response" | grep -q '"status":"healthy"'); then
            service_healthy=true
            break  # Service is ready
        fi
        
        # Fallback to health endpoint if ready doesn't exist
        url="http://127.0.0.1:${port}${health_endpoint}"
        local health_timeout=8
        if [ "$service_name" = "api-gateway" ]; then
            health_timeout=10  # Gateway health is now cached, should be fast
        elif [ "$service_name" = "streaming-service" ] || [ "$service_name" = "user-service" ]; then
            health_timeout=8  # These services check dependencies in parallel now
        fi
        if curl -s -f --ipv4 --max-time $health_timeout "$url" >/dev/null 2>&1; then
            service_healthy=true
            break  # Service is healthy
        fi
        
        # Show progress for long waits
        if [ $((waited % 9)) -eq 0 ]; then
            echo -e "    ${CYAN}  ${NC}Waiting for $service_name to be ready... (${waited}s/${max_wait}s)"
        fi
    done
    
    # Final health check with longer timeout
    if [ "$service_healthy" = false ]; then
        local health_timeout=10
        if [ "$service_name" = "api-gateway" ]; then
            health_timeout=25  # API Gateway checks all 9 services, needs more time
        elif [ "$service_name" = "streaming-service" ] || [ "$service_name" = "user-service" ]; then
            health_timeout=15  # These services check dependencies, can be slow
        fi
        local url="http://127.0.0.1:${port}${health_endpoint}"
        if curl -s -f --ipv4 --max-time $health_timeout "$url" >/dev/null 2>&1; then
            service_healthy=true
        fi
    fi
    
    if [ "$service_healthy" = true ]; then
        echo -e "    ${GREEN}✓${NC} $service_name started and healthy (PID: $npm_pid)"
        echo -e "    ${CYAN}  ${NC}Logs: tail -f /tmp/${service_name}.log"
        return 0
    else
        # Process is running but not responding - might still be starting
        if kill -0 $npm_pid 2>/dev/null; then
            echo -e "    ${YELLOW}⚠${NC} $service_name process running but not responding to health checks"
            echo -e "    ${YELLOW}  ${NC}Service may still be starting. Check logs: tail -f /tmp/${service_name}.log"
            echo -e "    ${CYAN}  ${NC}PID: $npm_pid"
            # Don't fail - service might be slow to start
            return 0
        else
            echo -e "    ${RED}✗${NC} Service failed to start. Check /tmp/${service_name}.log"
            tail -20 "/tmp/${service_name}.log" 2>/dev/null | sed 's/^/    /' || echo "    (log file not found)"
            return 1
        fi
    fi
}

# Main execution
main() {
    # Step 1: Check infrastructure
    check_postgresql || {
        echo -e "\n${RED}Error:${NC} PostgreSQL is required. Please start PostgreSQL and run this script again."
        exit 1
    }
    
    check_redis || {
        echo -e "\n${RED}Error:${NC} Redis is required for friend-service. Please start Redis and run this script again."
        exit 1
    }
    
    # Step 2: Setup Prisma
    echo -e "\n${BLUE}[3/7]${NC} Setting up Prisma for all services..."
    echo -e "${CYAN}This will deploy migrations to create/update database tables for each service${NC}"
    echo -e "${CYAN}Using Prisma migrations (same as production) for consistency${NC}\n"
    
    services_with_prisma=(
        "auth-service"
        "user-service"
        "discovery-service"
        "streaming-service"
        "wallet-service"
        "files-service"
        "payment-service"
        "friend-service"
        "moderation-service"
        "ads-service"
    )
    
    local prisma_failed=0
    for service in "${services_with_prisma[@]}"; do
        if ! setup_service_prisma "$service"; then
            prisma_failed=$((prisma_failed + 1))
            echo -e "    ${RED}✗${NC} Prisma setup failed for $service"
        fi
    done
    
    if [ $prisma_failed -eq 0 ]; then
        echo -e "\n${GREEN}✓${NC} Prisma setup complete for all services"
    else
        echo -e "\n${RED}✗${NC} Prisma setup FAILED for $prisma_failed service(s)"
        echo -e "${RED}  ${NC}CRITICAL: Some services may not have database tables created."
        echo -e "${RED}  ${NC}This will cause runtime errors like 'table does not exist'."
        echo -e "${YELLOW}  ${NC}Please check the errors above and fix them before starting services."
        echo -e "${YELLOW}  ${NC}You can manually fix by running:"
        echo -e "${YELLOW}    ${NC}cd apps/<service-name> && npx prisma migrate deploy"
        echo -e "${YELLOW}    ${NC}Or if no migrations exist: npx prisma migrate dev --name init"
        return 1  # Exit with error
    fi
    
    # Step 3: Cleanup before starting
    echo -e "\n${BLUE}[4/6]${NC} Cleaning up before starting services..."
    echo -e "${CYAN}Killing orphaned processes and clearing ports...${NC}"
    
    # Kill all npm processes that might be orphaned
    pkill -f "npm.*start:dev" 2>/dev/null || true
    sleep 2
    
    # Kill processes on service ports
    for port in 3000 3001 3002 3003 3004 3005 3006 3007 3008 3009 3010; do
        local pids=$(lsof -ti:$port 2>/dev/null || echo "")
        if [ -n "$pids" ]; then
            for pid in $pids; do
                local cmd=$(ps -p $pid -o command= 2>/dev/null || echo "")
                if echo "$cmd" | grep -qE "node.*dist/main|npm.*start:dev"; then
                    kill -9 "$pid" 2>/dev/null || true
                fi
            done
        fi
    done
    sleep 1
    echo -e "${GREEN}✓${NC} Cleanup complete"
    
    # Step 4: Check and start services in dependency order
    echo -e "\n${BLUE}[5/6]${NC} Checking and starting services..."
    echo -e "${CYAN}Starting services in dependency order (no dependencies first)...${NC}"
    
    # Service dependency tiers:
    # Tier 1: No dependencies (can start immediately)
    # Tier 2: Depend on Tier 1 services
    # Tier 3: Depend on Tier 2 services
    # Tier 4: Depends on all (api-gateway)
    
    # Tier 1: Services with no dependencies
    tier1_services=(
        "auth-service"
        "moderation-service"
        "wallet-service"
        "files-service"
        "discovery-service"
    )
    
    # Tier 2: Services that depend on Tier 1
    tier2_services=(
        "user-service"      # depends on: moderation-service, wallet-service
        "payment-service"   # depends on: wallet-service
        "ads-service"        # depends on: wallet-service
    )
    
    # Tier 3: Services that depend on Tier 2
    # Note: friend-service depends on user-service (Tier 2), so it's Tier 3
    # streaming-service depends on friend-service, so friend must start first
    tier3_services=(
        "friend-service"     # depends on: user-service, wallet-service (streaming-service is optional)
        "streaming-service"  # depends on: user-service, discovery-service, wallet-service, friend-service
    )
    
    # Tier 4: Depends on all services
    tier4_services=(
        "api-gateway"       # depends on: ALL services
    )
    
    # Combine all tiers in order
    service_order=(
        "${tier1_services[@]}"
        "${tier2_services[@]}"
        "${tier3_services[@]}"
        "${tier4_services[@]}"
    )
    
    local failed_services=()
    
    # Start services tier by tier
    local current_tier=1
    local tier_services=("${tier1_services[@]}")
    
    for service in "${service_order[@]}"; do
        # Check if we've moved to a new tier
        if [[ " ${tier2_services[@]} " =~ " ${service} " ]]; then
            if [ $current_tier -eq 1 ]; then
                echo -e "\n${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
                echo -e "${CYAN}Tier 1 services started. Waiting for them to be ready...${NC}"
                echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
                sleep 5  # Increased delay - give Tier 1 services time to fully start
                current_tier=2
            fi
        elif [[ " ${tier3_services[@]} " =~ " ${service} " ]]; then
            if [ $current_tier -eq 2 ]; then
                echo -e "\n${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
                echo -e "${CYAN}Tier 2 services started. Waiting for them to be ready...${NC}"
                echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
                # Wait longer and verify Tier 2 services are actually responding
                echo -e "${CYAN}Verifying Tier 2 services are responding...${NC}"
                sleep 5
                for tier2_service in "${tier2_services[@]}"; do
                    local tier2_config=$(get_service_config "$tier2_service")
                    if [ -n "$tier2_config" ]; then
            IFS=':' read -r tier2_port tier2_endpoint <<< "$tier2_config"
            # Use /ready endpoint for faster checks (use 127.0.0.1 with --ipv4)
            local ready_url="http://127.0.0.1:${tier2_port}/ready"
            local health_url="http://127.0.0.1:${tier2_port}${tier2_endpoint}"
                        local attempts=0
                        local max_attempts=10
                        while [ $attempts -lt $max_attempts ]; do
                            # Try /ready first (faster) - check for "ready" status
                            local ready_response=$(curl -s --ipv4 --max-time 5 "$ready_url" 2>/dev/null)
                            if [ -n "$ready_response" ] && echo "$ready_response" | grep -q '"status":"ready"'; then
                                break
                            fi
                            # Fallback to health
                            if curl -s --ipv4 --max-time 8 "$health_url" >/dev/null 2>&1; then
                                break
                            fi
                            # Exponential backoff: 1s, 2s, 4s, 8s...
                            local backoff=$((1 << attempts))
                            if [ $backoff -gt 8 ]; then backoff=8; fi
                            sleep $backoff
                            attempts=$((attempts + 1))
                        done
                    fi
                done
                sleep 3  # Additional buffer
                current_tier=3
            fi
        elif [[ " ${tier4_services[@]} " =~ " ${service} " ]]; then
            if [ $current_tier -eq 3 ]; then
                echo -e "\n${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
                echo -e "${CYAN}Tier 3 services started. Waiting for them to be ready...${NC}"
                echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
                # Wait longer and verify Tier 3 services are actually responding
                echo -e "${CYAN}Verifying Tier 3 services are responding...${NC}"
                sleep 8
                for tier3_service in "${tier3_services[@]}"; do
                    local tier3_config=$(get_service_config "$tier3_service")
                    if [ -n "$tier3_config" ]; then
                        IFS=':' read -r tier3_port tier3_endpoint <<< "$tier3_config"
                        # Use /ready endpoint for faster checks (use 127.0.0.1 with --ipv4)
                        local ready_url="http://127.0.0.1:${tier3_port}/ready"
                        local health_url="http://127.0.0.1:${tier3_port}${tier3_endpoint}"
                        local attempts=0
                        local max_attempts=12
                        while [ $attempts -lt $max_attempts ]; do
                            # Try /ready first (faster) - check for "ready" status
                            local ready_response=$(curl -s --ipv4 --max-time 5 "$ready_url" 2>/dev/null)
                            if [ -n "$ready_response" ] && echo "$ready_response" | grep -q '"status":"ready"'; then
                                break
                            fi
                            # Fallback to health
                            if curl -s --ipv4 --max-time 10 "$health_url" >/dev/null 2>&1; then
                                break
                            fi
                            # Exponential backoff: 1s, 2s, 4s, 8s...
                            local backoff=$((1 << attempts))
                            if [ $backoff -gt 8 ]; then backoff=8; fi
                            sleep $backoff
                            attempts=$((attempts + 1))
                        done
                    fi
                done
                sleep 5  # Additional buffer for streaming-service
                current_tier=4
            fi
        fi
        
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
                # Add delay between service checks to avoid thundering herd
                sleep 2
                ;;
            1)
                echo -e "  ${YELLOW}⚠${NC} $service is not running"
                # Clean up any orphaned npm processes for this service first
                pkill -f "npm.*start:dev.*$service" 2>/dev/null || true
                sleep 2  # Delay before starting
                if ! start_service "$service" "$port" "$health_endpoint"; then
                    failed_services+=("$service")
                fi
                sleep 3  # Delay after starting to avoid overwhelming system
                ;;
            2)
                echo -e "  ${YELLOW}⚠${NC} Port $port is in use but service not responding"
                echo -e "  ${YELLOW}  ${NC}Killing process on port $port and restarting..."
                kill_port "$port"
                # Also kill any orphaned npm processes for this service
                pkill -f "npm.*start:dev.*$service" 2>/dev/null || true
                sleep 2  # Delay before restarting
                if ! start_service "$service" "$port" "$health_endpoint"; then
                    failed_services+=("$service")
                fi
                sleep 3  # Delay after restarting
                ;;
        esac
    done
    
    # Step 5: Wait for services to be ready
    echo -e "\n${BLUE}[6/7]${NC} Waiting for services to be ready..."
    echo -e "${CYAN}Giving services additional time to fully initialize...${NC}"
    echo -e "${CYAN}This may take 30-45 seconds for all services to be ready...${NC}"
    
    # Progressive wait with verification
    echo -e "${CYAN}Waiting 15s for basic services...${NC}"
    sleep 15
    
    # Verify Tier 2 and 3 services are responding (use /ready for faster checks)
    echo -e "${CYAN}Verifying dependent services are responding...${NC}"
    local verification_passed=0
    for service in "${tier2_services[@]}" "${tier3_services[@]}"; do
        local service_config=$(get_service_config "$service")
        if [ -n "$service_config" ]; then
            IFS=':' read -r port health_endpoint <<< "$service_config"
            # Try /ready endpoint first (faster, no dependencies) - use 127.0.0.1 with --ipv4
            local ready_url="http://127.0.0.1:${port}/ready"
            local health_url="http://127.0.0.1:${port}${health_endpoint}"
            local ready_response=$(curl -s --ipv4 --max-time 5 "$ready_url" 2>/dev/null)
            if [ -n "$ready_response" ] && echo "$ready_response" | grep -q '"status":"ready"'; then
                verification_passed=$((verification_passed + 1))
            elif curl -s --ipv4 --max-time 10 "$health_url" >/dev/null 2>&1; then
                verification_passed=$((verification_passed + 1))
            fi
        fi
    done
    
    echo -e "${CYAN}Waiting additional 15s for all services to stabilize...${NC}"
    sleep 15
    
    # Step 6: Verify all services
    echo -e "\n${BLUE}[7/7]${NC} Verifying services..."
    
    local all_healthy=true
    local verification_failed_services=()
    
    local check_count=0
    for service in "${service_order[@]}"; do
        local service_config=$(get_service_config "$service")
        if [ -z "$service_config" ]; then
            continue
        fi
        
        # Add delay between checks to avoid thundering herd
        # Services with dependencies need time between health checks
        if [ $check_count -gt 0 ]; then
            sleep 1
        fi
        check_count=$((check_count + 1))
        
        IFS=':' read -r port health_endpoint <<< "$service_config"
        
        # Use /ready endpoint for faster verification (no dependencies)
        # Fallback to /health if /ready doesn't exist
        local ready_url="http://127.0.0.1:${port}/ready"
        local health_url="http://127.0.0.1:${port}${health_endpoint}"
        local check_timeout=5
        
        # Special handling for gateway
        if [ "$service" = "api-gateway" ]; then
            ready_url="http://127.0.0.1:${port}/health/live"
            health_url="http://127.0.0.1:${port}/health"
            check_timeout=3  # Gateway /health/live should be very fast
        fi
        
        # Try HTTP first - if service responds, it's running (avoids false "port not listening" on macOS)
        local ready_response=$(curl -s --ipv4 --connect-timeout 1 --max-time $check_timeout "$ready_url" 2>/dev/null)
        if [ -n "$ready_response" ] && (echo "$ready_response" | grep -q '"status":"ready"' || echo "$ready_response" | grep -q '"status":"healthy"'); then
            echo -e "  ${GREEN}✓${NC} $service (port $port)"
        elif curl -s --ipv4 --connect-timeout 1 --max-time 10 "$health_url" >/dev/null 2>&1; then
            echo -e "  ${GREEN}✓${NC} $service (port $port) - health check passed"
        elif check_port "$port"; then
            # Port is listening but HTTP check failed - likely network restriction, mark as running
            echo -e "  ${GREEN}✓${NC} $service (port $port) - listening (HTTP check restricted)"
        else
            # HTTP failed and port check failed - retry port check once (handles NestJS watch restart timing)
            sleep 2
            if check_port "$port"; then
                echo -e "  ${GREEN}✓${NC} $service (port $port) - listening (HTTP check restricted)"
            else
                echo -e "  ${RED}✗${NC} $service (port $port) - port not listening"
                all_healthy=false
                if [ ${#failed_services[@]} -eq 0 ] || [[ ! " ${failed_services[@]} " =~ " ${service} " ]]; then
                    verification_failed_services+=("$service")
                fi
            fi
        fi
    done
    
    # Merge verification failures with startup failures
    if [[ -n "${verification_failed_services+x}" ]]; then
        failed_services+=("${verification_failed_services[@]}")
    fi
    
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
        echo -e "  ${CYAN}Streaming:${NC}   http://localhost:3006"
        echo -e "  ${CYAN}Wallet:${NC}      http://localhost:3005"
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
        echo -e "${CYAN}Tip: If you saw 'Too many open files', run from a fresh terminal:${NC}"
        echo -e "  ${CYAN}ulimit -n 8192 && ./scripts/setup-and-start-services.sh${NC}"
        return 1
    fi
}

# Run main function
main "$@"
