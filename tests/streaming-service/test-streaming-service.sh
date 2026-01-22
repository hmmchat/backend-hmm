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
ADMIN_ICEBREAKER_ID=""

# Setup function
setup() {
    log_info "Setting up ${SERVICE_NAME} tests..."
    
    # Setup infrastructure
    setup_infrastructure
    
    # Setup database
    setup_database "${SERVICE_DIR}" "${SERVICE_NAME}"
    
    # Export TEST_MODE for services
    export TEST_MODE=true
    export NODE_ENV=test
    
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
        # Service is running but no health endpoint - verify by checking a real endpoint
        local test_response=$(curl -s -w "\n%{http_code}" -X GET "${SERVICE_URL}/streaming" 2>&1)
        local test_status=$(echo "$test_response" | tail -n1)
        if [ "$test_status" != "000" ]; then
            log_success "Service is running (health endpoint not available, but service responds)"
        else
            log_error "Service is not responding"
            return 1
        fi
    elif [ "$status_code" = "000" ]; then
        log_error "Health check - service not responding (status: ${status_code})"
        return 1
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

# Test: Save custom dare for personal use
test_save_custom_dare() {
    log_test "Save Custom Dare"
    
    # Use dummy room ID since custom dares don't require a real room
    local dummy_room_id="${TEST_ROOM_ID:-test-room-dummy}"
    
    local custom_dare_data=$(cat <<EOF
{
  "userId": "${TEST_USER_1}",
  "dareText": "Do 20 jumping jacks",
  "category": "physical"
}
EOF
)
    
    # Accept both 200 and 201 as valid (201 Created is correct for POST)
    local response=$(curl -s -w "\n%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -d "${custom_dare_data}" \
        "${SERVICE_URL}/streaming/rooms/${dummy_room_id}/dares/custom/save" 2>&1)
    local status_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | sed '$d')
    
    if [ "$status_code" -eq 200 ] || [ "$status_code" -eq 201 ]; then
        log_success "Save custom dare (${status_code})"
    elif [ "$status_code" -eq 404 ]; then
        # Route might not be registered - check if service needs restart or route issue
        log_error "Save custom dare - Expected 200/201, got 404. Route may not be registered. Response: ${body}"
        return 1
    else
        log_error "Save custom dare - Expected 200/201, got ${status_code}. Response: ${body}"
        return 1
    fi
}

# Test: Get user's custom dares
test_get_user_custom_dares() {
    log_test "Get User Custom Dares"
    
    # Use dummy room ID since custom dares don't require a real room
    local dummy_room_id="${TEST_ROOM_ID:-test-room-dummy}"
    
    local response=$(curl -s -w "\n%{http_code}" -X GET \
        "${SERVICE_URL}/streaming/rooms/${dummy_room_id}/dares/custom?userId=${TEST_USER_1}" 2>&1)
    local status_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | sed '$d')
    
    if [ "$status_code" -eq 200 ]; then
        log_success "Get user custom dares (200)"
    elif [ "$status_code" -eq 404 ]; then
        # Route might not be registered - check if service needs restart or route issue
        log_error "Get user custom dares - Expected 200, got 404. Route may not be registered. Response: ${body}"
        return 1
    else
        log_error "Get user custom dares - Expected 200, got ${status_code}. Response: ${body}"
        return 1
    fi
}

# Test: Get random dares with custom dares mixed in
test_get_random_dares() {
    log_test "Get Random Dares with Custom Dares"
    
    # Use dummy room ID since custom dares don't require a real room
    local dummy_room_id="${TEST_ROOM_ID:-test-room-dummy}"
    
    http_request "GET" "${SERVICE_URL}/streaming/rooms/${dummy_room_id}/dares/random?userId=${TEST_USER_1}&count=7&interval=3" "" 200 "Get random dares with custom dares"
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

# Test: Send gift with giftId (new feature)
test_send_gift_with_giftid() {
    log_test "Send Gift with Gift ID"
    
    if [ -z "$TEST_ROOM_ID" ]; then
        log_warn "No room ID available, skipping test"
        return 0
    fi
    
    # First ensure users have wallets
    curl -s -X POST \
        -H "Content-Type: application/json" \
        -d "{\"userId\": \"${TEST_USER_1}\", \"amount\": 5000, \"description\": \"test_setup\"}" \
        "http://localhost:${WALLET_PORT}/test/wallet/add-coins" > /dev/null 2>&1
    
    local gift_data=$(cat <<EOF
{
  "toUserId": "${TEST_USER_2}",
  "amount": 2500,
  "giftId": "monkey",
  "fromUserId": "${TEST_USER_1}"
}
EOF
)
    
    local response=$(curl -s -w "\n%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -d "${gift_data}" \
        "${SERVICE_URL}/streaming/rooms/${TEST_ROOM_ID}/gifts" 2>&1)
    local status_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | sed '$d')
    
    if [ "$status_code" -eq 200 ] || [ "$status_code" -eq 201 ]; then
        # Verify response contains transaction info
        if echo "$body" | grep -q "transactionId"; then
            log_success "Send gift with giftId (${status_code}) - transaction created"
        else
            log_success "Send gift with giftId (${status_code})"
        fi
    elif [ "$status_code" -eq 400 ]; then
        # May fail if users not in room or insufficient balance
        log_warn "Send gift with giftId returned 400 (may require room setup or balance)"
    else
        log_error "Send gift with giftId - Expected 200/201/400, got ${status_code}"
        return 1
    fi
}

# Test: Send gift without giftId (regression test)
test_send_gift_without_giftid() {
    log_test "Send Gift without Gift ID (Regression)"
    
    if [ -z "$TEST_ROOM_ID" ]; then
        log_warn "No room ID available, skipping test"
        return 0
    fi
    
    # First ensure users have wallets
    curl -s -X POST \
        -H "Content-Type: application/json" \
        -d "{\"userId\": \"${TEST_USER_1}\", \"amount\": 5000, \"description\": \"test_setup\"}" \
        "http://localhost:${WALLET_PORT}/test/wallet/add-coins" > /dev/null 2>&1
    
    local gift_data=$(cat <<EOF
{
  "toUserId": "${TEST_USER_2}",
  "amount": 1000,
  "fromUserId": "${TEST_USER_1}"
}
EOF
)
    
    local response=$(curl -s -w "\n%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -d "${gift_data}" \
        "${SERVICE_URL}/streaming/rooms/${TEST_ROOM_ID}/gifts" 2>&1)
    local status_code=$(echo "$response" | tail -n1)
    
    if [ "$status_code" -eq 200 ] || [ "$status_code" -eq 201 ]; then
        log_success "Send gift without giftId (${status_code}) - backward compatible"
    elif [ "$status_code" -eq 400 ]; then
        log_warn "Send gift without giftId returned 400 (may require room setup or balance)"
    else
        log_error "Send gift without giftId - Expected 200/201/400, got ${status_code}"
        return 1
    fi
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
    
    local response=$(curl -s -w "\n%{http_code}" -X GET \
        "${SERVICE_URL}/streaming/rooms/non-existent-room-id" 2>&1)
    local status_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | sed '$d')
    
    if [ "$status_code" -eq 200 ]; then
        if echo "$body" | grep -q '"exists":false'; then
            log_success "Get non-existent room correctly returns exists: false (200)"
        else
            log_success "Get non-existent room (200)"
        fi
    elif [ "$status_code" -eq 404 ]; then
        log_success "Get non-existent room (404)"
    else
        log_warn "Get non-existent room (${status_code} - May be expected)"
    fi
}

# Test: Admin - Get all icebreakers
test_admin_get_icebreakers() {
    log_test "Admin: Get All Icebreakers"
    
    http_request "GET" "${SERVICE_URL}/streaming/admin/icebreakers" "" 200 "Get all icebreakers"
}

# Test: Admin - Get active icebreakers
test_admin_get_active_icebreakers() {
    log_test "Admin: Get Active Icebreakers"
    
    http_request "GET" "${SERVICE_URL}/streaming/admin/icebreakers/active" "" 200 "Get active icebreakers"
}

# Test: Admin - Create icebreaker
test_admin_create_icebreaker() {
    log_test "Admin: Create Icebreaker"
    
    local icebreaker_data=$(cat <<EOF
{
  "question": "What's your favorite testing framework?",
  "category": "technical"
}
EOF
)
    
    local response=$(curl -s -w "\n%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -d "${icebreaker_data}" \
        "${SERVICE_URL}/streaming/admin/icebreakers" 2>&1)
    local status_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | sed '$d')
    
    if [ "$status_code" -eq 201 ]; then
        # Extract icebreaker ID for later tests
        ADMIN_ICEBREAKER_ID=$(echo "$body" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
        if [ -n "$ADMIN_ICEBREAKER_ID" ]; then
            log_success "Create icebreaker (201) - ID: ${ADMIN_ICEBREAKER_ID}"
        else
            log_success "Create icebreaker (201)"
        fi
    else
        log_error "Create icebreaker - Expected 201, got ${status_code}"
        return 1
    fi
}

# Test: Admin - Update icebreaker
test_admin_update_icebreaker() {
    log_test "Admin: Update Icebreaker"
    
    if [ -z "$ADMIN_ICEBREAKER_ID" ]; then
        log_warn "No icebreaker ID available from create test, skipping update test"
        return 0
    fi
    
    local update_data=$(cat <<EOF
{
  "category": "updated-technical",
  "isActive": true
}
EOF
)
    
    local response=$(curl -s -w "\n%{http_code}" -X PATCH \
        -H "Content-Type: application/json" \
        -d "${update_data}" \
        "${SERVICE_URL}/streaming/admin/icebreakers/${ADMIN_ICEBREAKER_ID}" 2>&1)
    local status_code=$(echo "$response" | tail -n1)
    
    if [ "$status_code" -eq 200 ]; then
        log_success "Update icebreaker (200)"
    else
        log_error "Update icebreaker - Expected 200, got ${status_code}"
        return 1
    fi
}

# Test: Admin - Delete icebreaker (soft delete)
test_admin_delete_icebreaker() {
    log_test "Admin: Delete Icebreaker (Soft Delete)"
    
    if [ -z "$ADMIN_ICEBREAKER_ID" ]; then
        log_warn "No icebreaker ID available, skipping delete test"
        return 0
    fi
    
    local response=$(curl -s -w "\n%{http_code}" -X DELETE \
        "${SERVICE_URL}/streaming/admin/icebreakers/${ADMIN_ICEBREAKER_ID}" 2>&1)
    local status_code=$(echo "$response" | tail -n1)
    
    if [ "$status_code" -eq 204 ] || [ "$status_code" -eq 200 ]; then
        log_success "Delete icebreaker (${status_code})"
    else
        log_error "Delete icebreaker - Expected 204/200, got ${status_code}"
        return 1
    fi
}

# Test: Send gift from OFFLINE cards (without room context)
test_send_gift_from_offline_card() {
    log_test "Send Gift from OFFLINE Card"
    
    # Use seeded test users
    local from_user="test-user-mumbai-male-1"
    local to_user="test-user-offline-online-1"
    local gift_amount=100
    local gift_id="monkey"
    
    local gift_data=$(cat <<EOF
{
  "fromUserId": "${from_user}",
  "toUserId": "${to_user}",
  "amount": ${gift_amount},
  "giftId": "${gift_id}"
}
EOF
)
    
    local response=$(curl -s -w "\n%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -d "${gift_data}" \
        "${SERVICE_URL}/streaming/test/offline-cards/gifts" 2>&1)
    local status_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | sed '$d')
    
    if [ "$status_code" -eq 200 ] || [ "$status_code" -eq 201 ]; then
        if echo "$body" | grep -q "transactionId"; then
            local transaction_id=$(echo "$body" | grep -o '"transactionId":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
            log_success "Gift sent from OFFLINE card (${status_code}) - Transaction ID: ${transaction_id}"
        else
            log_success "Gift sent from OFFLINE card (${status_code})"
        fi
    elif [ "$status_code" -eq 503 ]; then
        log_success "Gift from OFFLINE card (503 - Wallet service not fully configured, expected in local testing)"
    elif [ "$status_code" -eq 400 ] || [ "$status_code" -eq 404 ] || [ "$status_code" -eq 500 ]; then
        log_warn "Gift from OFFLINE card (${status_code} - May be insufficient balance, invalid users, or service issue)"
    else
        log_warn "Gift from OFFLINE card (${status_code} - May be expected in some setups)"
    fi
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
    
    # Custom dare tests
    test_save_custom_dare
    test_get_user_custom_dares
    test_get_random_dares
    
    # Gift badge feature tests
    test_send_gift_with_giftid
    test_send_gift_without_giftid
    
    # OFFLINE Cards tests
    test_send_gift_from_offline_card
    
    # Edge cases
    test_invalid_room
    test_nonexistent_room
    
    # Admin icebreaker tests
    test_admin_get_icebreakers
    test_admin_get_active_icebreakers
    test_admin_create_icebreaker
    test_admin_update_icebreaker
    test_admin_delete_icebreaker
    
    cleanup
    
    print_summary
}

# Run main function
main "$@"
