#!/bin/bash

# Master test runner - runs all service E2E tests
# Usage: ./run-all-tests.sh [service-name]
# If no service name provided, runs all tests

set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Run a single test
run_test() {
    local service=$1
    local script=""
    
    case "$service" in
        "auth") script="${SCRIPT_DIR}/auth-service/test-auth-service.sh" ;;
        "user") script="${SCRIPT_DIR}/user-service/test-user-service.sh" ;;
        "discovery") script="${SCRIPT_DIR}/discovery-service/test-discovery-service.sh" ;;
        "moderation") script="${SCRIPT_DIR}/moderation-service/test-moderation-service.sh" ;;
        "wallet") script="${SCRIPT_DIR}/wallet-service/test-wallet-service.sh" ;;
        "streaming") script="${SCRIPT_DIR}/streaming-service/test-streaming-service.sh" ;;
        "payment") script="${SCRIPT_DIR}/payment-service/test-payment-service.sh" ;;
        "files") script="${SCRIPT_DIR}/files-service/test-files-service.sh" ;;
        "friend") script="${SCRIPT_DIR}/friend-service/test-friend-service.sh" ;;
        *)
            echo -e "${YELLOW}Unknown service: ${service}${NC}"
            echo "Available services: auth, user, discovery, moderation, wallet, streaming, payment, files, friend"
            return 1
            ;;
    esac
    
    if [ -z "$script" ]; then
        echo -e "${YELLOW}Unknown service: ${service}${NC}"
        return 1
    fi
    
    if [ ! -f "$script" ]; then
        echo -e "${YELLOW}Test script not found: ${script}${NC}"
        return 1
    fi
    
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}Running tests for: ${service}${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
    
    bash "$script"
    local exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        echo -e "\n${GREEN}✓ ${service} tests passed${NC}\n"
    else
        echo -e "\n${YELLOW}⚠ ${service} tests had issues (exit code: ${exit_code})${NC}\n"
    fi
    
    return $exit_code
}

# Run all tests
run_all_tests() {
    echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║  Running All Service E2E Tests        ║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════╝${NC}\n"
    
    local total=0
    local passed=0
    local failed=0
    
    local services=("auth" "user" "discovery" "moderation" "wallet" "streaming" "payment" "files" "friend")
    
    for service in "${services[@]}"; do
        ((total++))
        if run_test "$service"; then
            ((passed++))
        else
            ((failed++))
        fi
        sleep 2  # Brief pause between services
    done
    
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}Final Summary${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "Total Services: ${total}"
    echo -e "${GREEN}Passed: ${passed}${NC}"
    echo -e "${YELLOW}Failed: ${failed}${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
    
    if [ $failed -eq 0 ]; then
        echo -e "${GREEN}All tests completed successfully!${NC}"
        return 0
    else
        echo -e "${YELLOW}Some tests had issues. Check logs above.${NC}"
        return 1
    fi
}

# Main
if [ $# -eq 0 ]; then
    run_all_tests
else
    run_test "$1"
fi
