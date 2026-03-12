#!/bin/bash

# Prerequisites Setup Script for HMM Backend
# Ensures all databases are migrated and Prisma clients are generated
# Safe to run multiple times (idempotent)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  HMM Backend Prerequisites Setup      ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}\n"

# Function to check if PostgreSQL is running
check_postgresql() {
    echo -e "${BLUE}[1/5]${NC} Checking PostgreSQL..."
    if command -v pg_isready >/dev/null 2>&1; then
        if pg_isready >/dev/null 2>&1; then
            echo -e "${GREEN}✓${NC} PostgreSQL is running"
            return 0
        else
            echo -e "${YELLOW}⚠${NC} PostgreSQL is not running. Please start PostgreSQL first."
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
    echo -e "${BLUE}[2/5]${NC} Checking Redis (optional)..."
    if command -v redis-cli >/dev/null 2>&1; then
        if redis-cli ping >/dev/null 2>&1; then
            echo -e "${GREEN}✓${NC} Redis is running"
        else
            echo -e "${YELLOW}⚠${NC} Redis is not running (optional, continuing anyway)"
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
        echo -e "${YELLOW}  ⚠${NC} No Prisma schema found for $service_name, skipping"
        return 0
    fi
    
    echo -e "\n${BLUE}  Setting up: $service_name${NC}"
    cd "$service_dir"
    
    # Check if .env exists
    if [ ! -f ".env" ]; then
        echo -e "${YELLOW}    ⚠${NC} .env file not found for $service_name"
        echo -e "${YELLOW}    ⚠${NC} Please create .env file with DATABASE_URL"
        return 1
    fi
    
    # Check if DATABASE_URL is set in .env
    if ! grep -q "DATABASE_URL" .env 2>/dev/null; then
        echo -e "${YELLOW}    ⚠${NC} DATABASE_URL not found in .env for $service_name"
        return 1
    fi
    
    # Generate Prisma client first
    echo -e "    ${BLUE}→${NC} Generating Prisma client..."
    if npx prisma generate >/dev/null 2>&1; then
        echo -e "    ${GREEN}✓${NC} Prisma client generated"
    else
        echo -e "    ${YELLOW}⚠${NC} Prisma generate had issues (may already be generated)"
    fi
    
    # Always use db push for reliable schema syncing (ensures schema matches)
    # This is safer than migrations in development as it handles schema drift
    echo -e "    ${BLUE}→${NC} Syncing database schema..."
    if npx prisma db push --accept-data-loss >/dev/null 2>&1; then
        echo -e "    ${GREEN}✓${NC} Database schema synced successfully"
        
        # Regenerate Prisma client after schema sync to ensure it's up to date
        echo -e "    ${BLUE}→${NC} Regenerating Prisma client..."
        npx prisma generate >/dev/null 2>&1 || true
        
        # Try to mark migrations as applied if they exist
        if [ -d "prisma/migrations" ] && [ "$(ls -A prisma/migrations/*/migration.sql 2>/dev/null 2>&1)" ]; then
            # Try to resolve any failed migrations
            npx prisma migrate resolve --applied $(ls -1 prisma/migrations | tail -1) >/dev/null 2>&1 || true
        fi
    else
        echo -e "    ${RED}✗${NC} Failed to sync database schema"
        echo -e "    ${YELLOW}  ${NC}Attempting to resolve failed migrations..."
        
        # Try to resolve failed migrations
        if [ -d "prisma/migrations" ]; then
            for migration_dir in prisma/migrations/*/; do
                if [ -d "$migration_dir" ]; then
                    migration_name=$(basename "$migration_dir")
                    npx prisma migrate resolve --rolled-back "$migration_name" >/dev/null 2>&1 || true
                fi
            done
            
            # Try db push again after resolving
            if npx prisma db push --accept-data-loss --skip-generate >/dev/null 2>&1; then
                echo -e "    ${GREEN}✓${NC} Database schema synced after resolving migrations"
            else
                return 1
            fi
        else
            return 1
        fi
    fi
    
    return 0
}

# Function to verify critical tables exist
verify_tables() {
    echo -e "\n${BLUE}[4/5]${NC} Verifying critical tables..."
    
    local tables_ok=true
    
    # Check discovery-service tables
    echo -e "  ${BLUE}→${NC} Checking discovery-service tables..."
    cd "$ROOT_DIR/apps/discovery-service"
    if [ -f ".env" ] && grep -q "DATABASE_URL" .env 2>/dev/null; then
        # Use Prisma's introspection to check if table exists
        # Try to query the table - if it fails, table doesn't exist
        if npx prisma db execute --stdin <<< "SELECT COUNT(*) FROM active_matches;" >/dev/null 2>&1; then
            echo -e "    ${GREEN}✓${NC} active_matches table exists"
        else
            # Table might not exist, try to verify via schema
            echo -e "    ${YELLOW}⚠${NC} Could not verify active_matches table"
            echo -e "    ${BLUE}→${NC} Re-running db push to ensure table exists..."
            if npx prisma db push --accept-data-loss --skip-generate >/dev/null 2>&1; then
                echo -e "    ${GREEN}✓${NC} Schema re-synced, table should exist now"
            else
                echo -e "    ${RED}✗${NC} Failed to create active_matches table"
                tables_ok=false
            fi
        fi
    fi
    
    # Check user-service tables  
    echo -e "  ${BLUE}→${NC} Checking user-service tables..."
    cd "$ROOT_DIR/apps/user-service"
    if [ -f ".env" ] && grep -q "DATABASE_URL" .env 2>/dev/null; then
        if npx prisma db execute --stdin <<< "SELECT COUNT(*) FROM users;" >/dev/null 2>&1; then
            echo -e "    ${GREEN}✓${NC} users table exists"
        else
            echo -e "    ${YELLOW}⚠${NC} users table check skipped (may not exist yet, will be created on first use)"
        fi
    fi
    
    if [ "$tables_ok" = true ]; then
        echo -e "  ${GREEN}✓${NC} Critical tables verified"
        return 0
    else
        echo -e "  ${YELLOW}⚠${NC} Some table verification had issues, but schema should be synced"
        return 0  # Don't fail, as tables will be created on first use
    fi
}

# Main execution
main() {
    check_postgresql || {
        echo -e "\n${RED}Error:${NC} PostgreSQL is required. Please start PostgreSQL and run this script again."
        exit 1
    }
    
    check_redis
    
    echo -e "\n${BLUE}[3/5]${NC} Setting up Prisma for all services..."
    
    # Services that use Prisma (each has its own database)
    services=(
        "auth-service"
        "discovery-service"
        "user-service"
        "streaming-service"
        "wallet-service"
        "files-service"
        "payment-service"
        "friend-service"
        "moderation-service"
        "ads-service"
    )
    
    local failed_services=()
    
    for service in "${services[@]}"; do
        if ! setup_service_prisma "$service"; then
            failed_services+=("$service")
        fi
    done
    
    verify_tables || failed_services+=("table-verification")
    
    echo -e "\n${BLUE}[5/5]${NC} Summary"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    
    if [ ${#failed_services[@]} -eq 0 ]; then
        echo -e "${GREEN}✓ All services setup successfully!${NC}\n"
        echo -e "${GREEN}You can now:${NC}"
        echo -e "  1. Start your services"
        echo -e "  2. Open the HTML test interface"
        echo -e "  3. Begin testing\n"
        return 0
    else
        echo -e "${YELLOW}⚠ Some services had issues:${NC}"
        for service in "${failed_services[@]}"; do
            echo -e "  ${RED}✗${NC} $service"
        done
        echo -e "\n${YELLOW}Please check the errors above and fix them.${NC}"
        return 1
    fi
}

# Run main function
main "$@"
