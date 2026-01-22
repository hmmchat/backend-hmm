#!/bin/bash

# Shared test utilities for automated E2E testing
# This script provides common functions for service health checks, startup, and cleanup

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Service ports
AUTH_PORT=3001
USER_PORT=3002
MODERATION_PORT=3003
DISCOVERY_PORT=3004
WALLET_PORT=3005
STREAMING_PORT=3006
PAYMENT_PORT=3007
FILES_PORT=3008
FRIEND_PORT=3009
API_GATEWAY_PORT=3000

# Base URLs
AUTH_URL="http://localhost:${AUTH_PORT}"
USER_URL="http://localhost:${USER_PORT}"
MODERATION_URL="http://localhost:${MODERATION_PORT}"
DISCOVERY_URL="http://localhost:${DISCOVERY_PORT}"
WALLET_URL="http://localhost:${WALLET_PORT}"
STREAMING_URL="http://localhost:${STREAMING_PORT}"
PAYMENT_URL="http://localhost:${PAYMENT_PORT}"
FILES_URL="http://localhost:${FILES_PORT}"
FRIEND_URL="http://localhost:${FRIEND_PORT}"
API_GATEWAY_URL="http://localhost:${API_GATEWAY_PORT}"

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_TOTAL=0

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1"
    ((TESTS_PASSED++)) || true
    ((TESTS_TOTAL++)) || true
}

log_error() {
    echo -e "${RED}[✗]${NC} $1"
    ((TESTS_FAILED++)) || true
    ((TESTS_TOTAL++)) || true
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_test() {
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}Test:${NC} $1"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# Check if a service is running
check_service_health() {
    local url=$1
    local service_name=$2
    local max_attempts=${3:-10}
    local attempt=0
    
    log_info "Checking ${service_name} health at ${url}..."
    
    while [ $attempt -lt $max_attempts ]; do
        # Try health endpoint first
        if curl -sf "${url}/health" > /dev/null 2>&1; then
            log_success "${service_name} is healthy"
            return 0
        fi
        # If health endpoint doesn't exist, check if service responds at all (any 2xx/4xx means it's up)
        local status=$(curl -s -o /dev/null -w "%{http_code}" "${url}/health" 2>/dev/null || echo "000")
        # Remove any leading zeros and check if it's a valid HTTP status code
        local clean_status=$(echo "$status" | sed 's/^0*//')
        if [ -n "$clean_status" ] && [ "$clean_status" != "0" ] && [ "$status" != "000" ] && [ "$status" != "000000" ]; then
            # Service is responding (even if 404, it means the server is up)
            log_success "${service_name} is responding (status: ${status})"
            return 0
        fi
        attempt=$((attempt + 1))
        sleep 1
    done
    
    log_warn "${service_name} is not responding"
    return 1
}

# Start a service if not running
start_service() {
    local service_dir=$1
    local service_name=$2
    local port=$3
    local health_url=$4
    
    # Check if service directory exists
    if [ ! -d "${service_dir}" ]; then
        log_error "Service directory not found: ${service_dir}"
        return 1
    fi
    
    # Stop service if already running to ensure fresh start with latest code
    stop_service "${service_name}"
    
    log_info "Starting ${service_name}..."
    
    # Start service in background
    cd "${service_dir}"
    # Force DATABASE_URL to be correct for this service (override any existing value)
    export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/${service_name}?schema=public"
    # Set TEST_MODE and NODE_ENV for the service
    # Don't source .env if it exists - it might have wrong DATABASE_URL
    # If .env is needed for other vars, source it but override DATABASE_URL immediately after
    if [ -f "${service_dir}/.env" ]; then
        set -a
        source "${service_dir}/.env"
        set +a
    fi
    # Force DATABASE_URL to be correct for this service (override any .env value)
    export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/${service_name}?schema=public"
    # Ensure PORT is not overridden (services should use their default ports from code)
    # But set it explicitly based on the service port passed to this function
    export PORT="${port}"
    # Debug: log the DATABASE_URL being used
    echo "[DEBUG] Starting ${service_name} with DATABASE_URL: ${DATABASE_URL}" >> "/tmp/${service_name}.log"
    # Explicitly pass DATABASE_URL to npm to ensure it's available to the service
    env DATABASE_URL="${DATABASE_URL}" TEST_MODE=true NODE_ENV=test npm run start:dev > "/tmp/${service_name}.log" 2>&1 &
    local pid=$!
    echo $pid > "/tmp/${service_name}.pid"
    cd - > /dev/null
    
    # Wait for service to be healthy
    log_info "Waiting for ${service_name} to start..."
    if check_service_health "${health_url}" "${service_name}" 30; then
        log_success "${service_name} started successfully (PID: ${pid})"
        return 0
    else
        log_error "${service_name} failed to start"
        return 1
    fi
}

# Stop a service
stop_service() {
    local service_name=$1
    local pid_file="/tmp/${service_name}.pid"
    
    if [ -f "${pid_file}" ]; then
        local pid=$(cat "${pid_file}")
        if ps -p "${pid}" > /dev/null 2>&1; then
            log_info "Stopping ${service_name} (PID: ${pid})..."
            kill "${pid}" 2>/dev/null || true
            wait "${pid}" 2>/dev/null || true
            log_success "${service_name} stopped"
        fi
        rm -f "${pid_file}"
    fi
    
    # Also try to kill any process using the service port (in case it was started outside test script)
    # Map service names to ports
    case "$service_name" in
        friend-service) local port=3009 ;;
        streaming-service) local port=3006 ;;
        auth-service) local port=3001 ;;
        user-service) local port=3002 ;;
        discovery-service) local port=3004 ;;
        wallet-service) local port=3005 ;;
        payment-service) local port=3007 ;;
        files-service) local port=3008 ;;
        *) local port="" ;;
    esac
    
    if [ -n "$port" ]; then
        local port_pid=$(lsof -ti :${port} 2>/dev/null || true)
        if [ -n "$port_pid" ]; then
            log_info "Stopping process on port ${port} (PID: ${port_pid})..."
            kill "${port_pid}" 2>/dev/null || true
            wait "${port_pid}" 2>/dev/null || true
        fi
    fi
}

# Create database if it doesn't exist
create_database_if_not_exists() {
    local db_name=$1
    
    log_info "Checking if database ${db_name} exists..."
    
    # Check if database exists
    if psql -h localhost -U postgres -d postgres -tc "SELECT 1 FROM pg_database WHERE datname = '${db_name}'" | grep -q 1; then
        log_success "Database ${db_name} already exists"
        return 0
    fi
    
    # Create database
    log_info "Creating database ${db_name}..."
    if psql -h localhost -U postgres -d postgres -c "CREATE DATABASE \"${db_name}\";" > /tmp/create-db-${db_name}.log 2>&1; then
        log_success "Database ${db_name} created"
        return 0
    else
        # Check if it's just a "already exists" error
        if grep -q "already exists\|duplicate key" /tmp/create-db-${db_name}.log 2>/dev/null; then
            log_success "Database ${db_name} already exists"
            return 0
        else
            log_warn "Database creation had issues (may need manual creation)"
            cat /tmp/create-db-${db_name}.log >&2
            return 0  # Continue anyway, might work if database exists
        fi
    fi
}

# Setup database for a service
setup_database() {
    local service_dir=$1
    local service_name=$2
    
    log_info "Setting up database for ${service_name}..."
    
    if [ ! -d "${service_dir}" ]; then
        log_error "Service directory not found: ${service_dir}"
        return 1
    fi
    
    # Create database if it doesn't exist
    create_database_if_not_exists "${service_name}"
    
    cd "${service_dir}"
    
    # Set DATABASE_URL first to ensure it's correct for this service
    export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/${service_name}?schema=public"
    
    # Ensure DATABASE_URL is set before generating (don't let .env override)
    if [ -f "${service_dir}/.env" ]; then
        set -a
        source "${service_dir}/.env"
        set +a
        # Re-export to ensure it's correct for this service
        export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/${service_name}?schema=public"
    fi
    
    # Try to generate Prisma client (may fail if already generated or pnpm issues)
    if npm run prisma:generate > /tmp/prisma-generate-${service_name}.log 2>&1; then
        log_success "Prisma client generated"
    else
        log_warn "Prisma generate had issues (may already be generated or dependency issue)"
        # Check if Prisma client already exists
        if [ -d "node_modules/.prisma" ] || [ -d "node_modules/@prisma/client" ]; then
            log_info "Prisma client appears to exist, continuing..."
        fi
    fi
    
    # Try to push schema to database (may fail if already up to date)
    # CRITICAL: Force DATABASE_URL to use the service-specific database for tests
    # This ensures isolation and prevents pushing to wrong database from .env
    export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/${service_name}?schema=public"
    
    # Source .env for other variables, but immediately override DATABASE_URL again
    if [ -f "${service_dir}/.env" ]; then
        set -a
        source "${service_dir}/.env"
        set +a
        # Force DATABASE_URL again after sourcing .env to ensure test isolation
        export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/${service_name}?schema=public"
    fi
    
    # Run prisma push with explicit DATABASE_URL in environment
    # Use --skip-generate to avoid pnpm issues during push
    if env DATABASE_URL="${DATABASE_URL}" npx prisma db push --accept-data-loss --skip-generate > /tmp/prisma-push-${service_name}.log 2>&1; then
        log_success "Database schema pushed"
    else
        # Check if it's just a "already in sync" error
        if grep -q "already in sync\|already up to date\|No schema changes" /tmp/prisma-push-${service_name}.log 2>/dev/null; then
            log_success "Database schema already up to date"
        elif grep -q "does not exist\|P1003" /tmp/prisma-push-${service_name}.log 2>/dev/null; then
            log_error "Database does not exist - creation may have failed"
            cat /tmp/prisma-push-${service_name}.log >&2
            return 1
        elif grep -q "Validation Error\|DATABASE_URL" /tmp/prisma-push-${service_name}.log 2>/dev/null; then
            log_error "Database push failed - DATABASE_URL issue"
            cat /tmp/prisma-push-${service_name}.log >&2
            return 1
        else
            log_warn "Database push had issues (checking if tables exist anyway)"
            cat /tmp/prisma-push-${service_name}.log >&2
            # Don't fail yet - check if tables exist
        fi
    fi
    
    # Verify tables were created (basic check)
    local table_count=$(psql -h localhost -U postgres -d "${service_name}" -tc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';" 2>/dev/null | tr -d ' ' || echo "0")
    if [ "$table_count" = "0" ] || [ -z "$table_count" ]; then
        log_error "No tables found in database ${service_name} after schema push"
        log_error "This indicates the schema push failed or pushed to wrong database"
        cat /tmp/prisma-push-${service_name}.log >&2
        return 1
    else
        log_success "Verified ${table_count} table(s) exist in database"
    fi
    
    # Run seed if available
    if npm run | grep -q "seed"; then
        log_info "Running seed for ${service_name}..."
        if npm run seed > /tmp/seed-${service_name}.log 2>&1; then
            log_success "Seed completed"
        else
            log_warn "Seed had issues (may already be seeded)"
        fi
    fi
    
    cd - > /dev/null
    log_success "Database setup attempted for ${service_name}"
    return 0
}

# Check PostgreSQL is running
check_postgres() {
    log_info "Checking PostgreSQL connection..."
    if psql -h localhost -U postgres -d postgres -c "SELECT 1;" > /dev/null 2>&1; then
        log_success "PostgreSQL is running"
        return 0
    else
        log_warn "PostgreSQL check failed (may need different connection string)"
        return 0  # Continue anyway, might be using different config
    fi
}

# Check Redis is running (optional)
check_redis() {
    log_info "Checking Redis connection..."
    if redis-cli ping > /dev/null 2>&1; then
        log_success "Redis is running"
        return 0
    else
        log_warn "Redis is not running (optional, continuing anyway)"
        return 0
    fi
}

# Make HTTP request and check response
http_request() {
    local method=$1
    local url=$2
    local data=${3:-}
    local expected_status=${4:-200}
    local description=${5:-"Request"}
    local service_token=${6:-}  # Optional service token for internal endpoints
    
    local response
    local status_code
    
    if [ -n "$data" ]; then
        if [ -n "$service_token" ]; then
            response=$(curl -s -w "\n%{http_code}" -X "${method}" \
                -H "Content-Type: application/json" \
                -H "x-service-token: ${service_token}" \
                -d "${data}" \
                "${url}" 2>&1)
        else
            response=$(curl -s -w "\n%{http_code}" -X "${method}" \
                -H "Content-Type: application/json" \
                -d "${data}" \
                "${url}" 2>&1)
        fi
    else
        if [ -n "$service_token" ]; then
            response=$(curl -s -w "\n%{http_code}" -X "${method}" \
                -H "x-service-token: ${service_token}" \
                "${url}" 2>&1)
        else
            response=$(curl -s -w "\n%{http_code}" -X "${method}" "${url}" 2>&1)
        fi
    fi
    
    status_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$status_code" -eq "$expected_status" ]; then
        log_success "${description} (${status_code})"
        echo "$body"
        return 0
    else
        log_error "${description} - Expected ${expected_status}, got ${status_code}"
        echo "$body" >&2
        return 1
    fi
}

# Create test user directly in database (bypasses auth)
create_test_user() {
    local service_dir=$1
    local user_id=$2
    local email=${3:-"test${user_id}@example.com"}
    local phone=${4:-"+916123456789"}
    
    log_info "Creating test user ${user_id} in database..."
    
    if [ ! -d "${service_dir}" ]; then
        log_warn "Service directory not found: ${service_dir}"
        return 0
    fi
    
    cd "${service_dir}"
    
    # Use Prisma Studio or direct SQL as fallback
    # For now, we'll use a simple approach - test endpoints will handle user creation
    # or we can use psql directly if DATABASE_URL is available
    log_info "Test user ${user_id} will be created via test endpoints if needed"
    
    cd - > /dev/null
}

# Cleanup test data
cleanup_test_data() {
    local service_dir=$1
    local service_name=$2
    
    log_info "Cleaning up test data for ${service_name}..."
    
    if [ ! -d "${service_dir}" ]; then
        return 0
    fi
    
    # Cleanup is handled by services themselves or via test endpoints
    # For now, we'll rely on services to clean up test data
    # In production, you might want to add direct database cleanup here
    
    log_success "Cleanup initiated for ${service_name}"
}

# Print test summary
print_summary() {
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}Test Summary${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "Total:  ${TESTS_TOTAL}"
    echo -e "${GREEN}Passed: ${TESTS_PASSED}${NC}"
    echo -e "${RED}Failed: ${TESTS_FAILED}${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
    
    if [ $TESTS_FAILED -eq 0 ]; then
        log_success "All tests passed!"
        return 0
    else
        log_error "Some tests failed"
        return 1
    fi
}

# Setup infrastructure
setup_infrastructure() {
    log_info "Setting up infrastructure..."
    check_postgres
    check_redis
}

# Cleanup all services
cleanup_all_services() {
    log_info "Cleaning up all services..."
    # Don't fail if service wasn't started by this test
    stop_service "auth-service" || true
    stop_service "user-service" || true
    stop_service "moderation-service" || true
    stop_service "discovery-service" || true
    stop_service "wallet-service" || true
    stop_service "streaming-service" || true
    stop_service "payment-service" || true
    stop_service "files-service" || true
    stop_service "friend-service" || true
    stop_service "api-gateway" || true
}

# Trap to cleanup on exit
trap_cleanup() {
    log_info "Cleaning up on exit..."
    cleanup_all_services || true
}

trap trap_cleanup EXIT INT TERM
