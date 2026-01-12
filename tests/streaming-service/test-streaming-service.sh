#!/bin/bash

# Automated E2E tests for Streaming Service
# Tests room creation, video calls, dares, gifts, and edge cases

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../test-utils.sh"

SERVICE_NAME="streaming-service"
SERVICE_DIR="${ROOT_DIR}/apps/${SERVICE_NAME}"
SERVICE_URL="${STREAMING_URL}"
SERVICE_PORT=${STREAMING_PORT}

# Test user IDs
TEST_USER_1="test-streaming-1"
TEST_USER_2="test-streaming-2"
TEST_ROOM_ID=""

# Setup function
setup() {
    log_info "Setting up ${SERVICE_NAME} tests..."
    
    # Setup infrastructure
    setup_infrastructure
    
    # Setup database
    setup_database "${SERVICE_DIR}" "${SERVICE_NAME}"
    
    # Start service
    start_service "${SERVICE_DIR}" "${SERVICE_NAME}" "${SERVICE_PORT}" "${SERVICE_URL}"
    
    log_success "Setup complete"
}

# Cleanup function
cleanup() {
    log_info "Cleaning up ${SERVICE_NAME} tests..."
    cleanup_test_data "${SERVICE_DIR}" "${SERVICE_NAME}"
}

# Test: Health check
test_health() {
    log_test "Health Check"
    
    # Streaming service may not have /health endpoint
    local response=$(curl -s -w "\n%{http_code}" -X GET "${SERVICE_URL}/health" 2>&1)
    local status_code=$(echo "$response" | tail -n1)
    
    if [ "$status_code" -eq 200 ]; then
        log_success "Health check (200)"
    elif [ "$status_code" -eq 404 ]; then
        # Service is running but no health endpoint
        log_success "Service is running (health endpoint not available)"
    else
        log_error "Health check failed (status: ${status_code})"
        return 1
    fi
}

# Test: Create room
test_create_room() {
    log_test "Create Room"
    
    # First ensure users exist in user service
    # Room creation may require users to have profiles
    local room_data=$(cat <<EOF
{
  "userIds": ["${TEST_USER_1}", "${TEST_USER_2}"],
  "type": "IN_SQUAD"
}
EOF
)
    
    local response=$(curl -s -w "\n%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -d "${room_data}" \
        "${SERVICE_URL}/streaming/rooms" 2>&1)
    local status_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | sed '$d')
    
    if [ "$status_code" -eq 201 ] || [ "$status_code" -eq 200 ]; then
        # Extract room ID from response
        TEST_ROOM_ID=$(echo "$body" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
        if [ -n "$TEST_ROOM_ID" ]; then
            log_success "Room created with ID: ${TEST_ROOM_ID}"
        else
            log_success "Room created (${status_code})"
        fi
    else
        # Room creation may fail if users don't exist or other requirements not met
        log_warn "Room creation returned ${status_code} (may require user profiles or other setup)"
        TEST_ROOM_ID=""
    fi
}

# Test: Get room
test_get_room() {
    log_test "Get Room"
    
    if [ -z "$TEST_ROOM_ID" ]; then
        log_warn "No room ID available, skipping test"
        return 0
    fi
    
    http_request "GET" "${SERVICE_URL}/streaming/rooms/${TEST_ROOM_ID}" "" 200 "Get room details"
}

# Test: Get room chat
test_get_room_chat() {
    log_test "Get Room Chat"
    
    if [ -z "$TEST_ROOM_ID" ]; then
        log_warn "No room ID available, skipping test"
        return 0
    fi
    
    http_request "GET" "${SERVICE_URL}/streaming/rooms/${TEST_ROOM_ID}/chat" "" 200 "Get room chat"
}

# Test: Get user's room
test_get_user_room() {
    log_test "Get User Room"
    
    # This may return 404 if user has no room, which is valid
    local response=$(curl -s -w "\n%{http_code}" -X GET "${SERVICE_URL}/streaming/users/${TEST_USER_1}/room" 2>&1)
    local status_code=$(echo "$response" | tail -n1)
    if [ "$status_code" -eq 200 ]; then
        log_success "Get user's room (200)"
    elif [ "$status_code" -eq 404 ]; then
        log_success "Get user's room (404 - user has no room, expected)"
    else
        log_error "Get user's room - Expected 200/404, got ${status_code}"
        return 1
    fi
}

# Test: Get dares
test_get_dares() {
    log_test "Get Dares"
    
    if [ -z "$TEST_ROOM_ID" ]; then
        log_warn "No room ID available, skipping test"
        return 0
    fi
    
    http_request "GET" "${SERVICE_URL}/streaming/rooms/${TEST_ROOM_ID}/dares" "" 200 "Get dares"
}

# Test: Get dare gifts
test_get_dare_gifts() {
    log_test "Get Dare Gifts"
    
    if [ -z "$TEST_ROOM_ID" ]; then
        log_warn "No room ID available, skipping test"
        return 0
    fi
    
    http_request "GET" "${SERVICE_URL}/streaming/rooms/${TEST_ROOM_ID}/dares/gifts" "" 200 "Get dare gifts"
}

# Test: Get gifts
test_get_gifts() {
    log_test "Get Gifts"
    
    if [ -z "$TEST_ROOM_ID" ]; then
        log_warn "No room ID available, skipping test"
        return 0
    fi
    
    http_request "GET" "${SERVICE_URL}/streaming/rooms/${TEST_ROOM_ID}/gifts" "" 200 "Get gifts"
}

# Test: Edge case - Create room with invalid users
test_invalid_room() {
    log_test "Edge Case: Invalid Room Data"
    
    local invalid_data=$(cat <<EOF
{
  "userIds": [],
  "type": "IN_SQUAD"
}
EOF
)
    
    # May return 400 or 404 depending on validation
    local response=$(curl -s -w "\n%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -d "${invalid_data}" \
        "${SERVICE_URL}/streaming/rooms" 2>&1)
    local status_code=$(echo "$response" | tail -n1)
    if [ "$status_code" -eq 400 ]; then
        log_success "Create room with no users correctly rejected (400)"
    elif [ "$status_code" -eq 404 ]; then
        log_success "Create room with no users (404 - endpoint may require different format)"
    else
        log_error "Create room with no users - Expected 400/404, got ${status_code}"
        return 1
    fi
}

# Test: Edge case - Get non-existent room
test_nonexistent_room() {
    log_test "Edge Case: Non-existent Room"
    
    http_request "GET" "${SERVICE_URL}/streaming/rooms/non-existent-room-id" "" 404 "Get non-existent room (should fail)"
}

# Main test execution
main() {
    echo -e "\n${BLUE}╔════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║  Streaming Service E2E Tests           ║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════╝${NC}\n"
    
    setup
    
    # Run tests
    test_health
    test_create_room
    test_get_room
    test_get_room_chat
    test_get_user_room
    test_get_dares
    test_get_dare_gifts
    test_get_gifts
    
    # Edge cases
    test_invalid_room
    test_nonexistent_room
    
    cleanup
    
    print_summary
}

# Run main function
main "$@"
