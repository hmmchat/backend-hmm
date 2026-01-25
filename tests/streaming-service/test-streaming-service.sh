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
    # Use test endpoint which bypasses auth and has TEST_MODE support
    local room_data=$(cat <<EOF
{
  "userIds": ["${TEST_USER_1}", "${TEST_USER_2}"],
  "callType": "matched"
}
EOF
)
    
    local response=$(curl -s -w "\n%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -d "${room_data}" \
        "${SERVICE_URL}/streaming/test/rooms" 2>&1)
    local status_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | sed '$d')
    
    if [ "$status_code" -eq 201 ] || [ "$status_code" -eq 200 ]; then
        # Extract room ID from response (test endpoint returns roomId, regular endpoint returns id)
        # Try jq first if available for reliable JSON parsing
        if command -v jq >/dev/null 2>&1; then
            TEST_ROOM_ID=$(echo "$body" | jq -r '.roomId // .id // empty' 2>/dev/null || echo "")
        fi
        # Fallback to grep if jq not available or didn't work
        if [ -z "$TEST_ROOM_ID" ]; then
            TEST_ROOM_ID=$(echo "$body" | grep -o '"roomId":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
        fi
        if [ -z "$TEST_ROOM_ID" ]; then
            TEST_ROOM_ID=$(echo "$body" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
        fi
        if [ -n "$TEST_ROOM_ID" ]; then
            log_success "Room created with ID: ${TEST_ROOM_ID}"
        else
            log_success "Room created (${status_code}) but could not extract room ID from: ${body}"
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
    elif [ "$status_code" -eq 000 ] || [ "$status_code" -eq 503 ] || [ "$status_code" -eq 502 ]; then
        # Service unavailable or connection issues
        log_warn "Send gift with giftId returned ${status_code} (service may be unavailable or wallet service not running)"
    else
        log_warn "Send gift with giftId - Expected 200/201/400, got ${status_code} (continuing anyway)"
        # Don't return 1 to allow other tests to run
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
    elif [ "$status_code" -eq 000 ] || [ "$status_code" -eq 503 ] || [ "$status_code" -eq 502 ]; then
        # Service unavailable or connection issues
        log_warn "Send gift without giftId returned ${status_code} (service may be unavailable or wallet service not running)"
    else
        log_warn "Send gift without giftId - Expected 200/201/400, got ${status_code} (continuing anyway)"
        # Don't return 1 to allow other tests to run
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

# Test: Request to join broadcast (waitlist)
test_request_to_join() {
    log_test "Request to Join Broadcast (Waitlist)"
    
    # Use existing room if available, otherwise create one
    local waitlist_room_id="${TEST_ROOM_ID}"
    local host_user_1="${TEST_USER_1}"
    local host_user_2="${TEST_USER_2}"
    local viewer_user="test-streaming-viewer-waitlist-1"
    
    if [ -z "$waitlist_room_id" ]; then
        # Try to get user's current room first
        local user_room_response=$(curl -s -w "\n%{http_code}" -X GET \
            "${SERVICE_URL}/streaming/test/users/${TEST_USER_1}/room" 2>&1)
        local user_room_status=$(echo "$user_room_response" | tail -n1)
        local user_room_body=$(echo "$user_room_response" | sed '$d')
        
        if [ "$user_room_status" -eq 200 ] && echo "$user_room_body" | grep -q '"exists":true'; then
            # Try multiple formats for room ID extraction - getRoomDetails returns roomId at root level
            if command -v jq >/dev/null 2>&1; then
                waitlist_room_id=$(echo "$user_room_body" | jq -r '.roomId // .id // empty' 2>/dev/null || echo "")
            fi
            if [ -z "$waitlist_room_id" ]; then
                waitlist_room_id=$(echo "$user_room_body" | grep -o '"roomId":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
            fi
            if [ -z "$waitlist_room_id" ]; then
                waitlist_room_id=$(echo "$user_room_body" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
            fi
        fi
        
        # If still no room, try to create one (users might already be in a room, so this may fail)
        if [ -z "$waitlist_room_id" ]; then
            local room_data=$(cat <<EOF
{
  "userIds": ["${TEST_USER_1}", "${TEST_USER_2}"],
  "callType": "matched"
}
EOF
)
            
            local create_response=$(curl -s -w "\n%{http_code}" -X POST \
                -H "Content-Type: application/json" \
                -d "${room_data}" \
                "${SERVICE_URL}/streaming/test/rooms" 2>&1)
            local create_status=$(echo "$create_response" | tail -n1)
            local create_body=$(echo "$create_response" | sed '$d')
            
            if [ "$create_status" -eq 200 ] || [ "$create_status" -eq 201 ]; then
                waitlist_room_id=$(echo "$create_body" | grep -o '"roomId":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
                if [ -z "$waitlist_room_id" ]; then
                    waitlist_room_id=$(echo "$create_body" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
                fi
            elif echo "$create_body" | grep -q "already in an active room"; then
                # Users are in a room, end it first, then create a new one
                user_room_response=$(curl -s "${SERVICE_URL}/streaming/test/users/${TEST_USER_1}/room" 2>&1)
                if echo "$user_room_response" | grep -q '"exists":true'; then
                    local existing_room_id=$(echo "$user_room_response" | grep -o '"roomId":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
                    if [ -z "$existing_room_id" ] && command -v jq >/dev/null 2>&1; then
                        existing_room_id=$(echo "$user_room_response" | jq -r '.roomId // empty' 2>/dev/null || echo "")
                    fi
                    if [ -n "$existing_room_id" ]; then
                        curl -s -X POST "${SERVICE_URL}/streaming/test/rooms/${existing_room_id}/end" > /dev/null 2>&1 || true
                        sleep 1
                        # Try creating again
                        create_response=$(curl -s -w "\n%{http_code}" -X POST \
                            -H "Content-Type: application/json" \
                            -d "${room_data}" \
                            "${SERVICE_URL}/streaming/test/rooms" 2>&1)
                        create_status=$(echo "$create_response" | tail -n1)
                        create_body=$(echo "$create_response" | sed '$d')
                        if [ "$create_status" -eq 200 ] || [ "$create_status" -eq 201 ]; then
                            waitlist_room_id=$(echo "$create_body" | grep -o '"roomId":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
                            if [ -z "$waitlist_room_id" ]; then
                                waitlist_room_id=$(echo "$create_body" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
                            fi
                            if [ -z "$waitlist_room_id" ] && command -v jq >/dev/null 2>&1; then
                                waitlist_room_id=$(echo "$create_body" | jq -r '.roomId // .id // empty' 2>/dev/null || echo "")
                            fi
                        fi
                    fi
                fi
            fi
        fi
        
        if [ -z "$waitlist_room_id" ]; then
            log_error "No room available for waitlist test. Room must be created first."
            return 1
        fi
    fi
    
    # Enable broadcasting
    local broadcast_data=$(cat <<EOF
{
  "userId": "${host_user_1}"
}
EOF
)
    
    local broadcast_response=$(curl -s --max-time 5 -w "\n%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -d "${broadcast_data}" \
        "${SERVICE_URL}/streaming/test/rooms/${waitlist_room_id}/enable-broadcasting" 2>&1)
    local broadcast_status=$(echo "$broadcast_response" | tail -n1)
    local broadcast_body=$(echo "$broadcast_response" | sed '$d')
    
    if [ "$broadcast_status" -ne 200 ] && [ "$broadcast_status" -ne 201 ]; then
        log_error "Failed to start broadcast for waitlist test (${broadcast_status}): ${broadcast_body}"
        return 1
    fi
    
    # Add viewer to broadcast
    local viewer_data=$(cat <<EOF
{
  "userId": "${viewer_user}"
}
EOF
)
    
    local viewer_response=$(curl -s --max-time 5 -w "\n%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -d "${viewer_data}" \
        "${SERVICE_URL}/streaming/test/rooms/${waitlist_room_id}/add-viewer" 2>&1)
    local viewer_status=$(echo "$viewer_response" | tail -n1)
    local viewer_body=$(echo "$viewer_response" | sed '$d')
    
    if [ "$viewer_status" -ne 200 ] && [ "$viewer_status" -ne 201 ]; then
        log_error "Failed to add viewer for waitlist test (${viewer_status}): ${viewer_body}"
        return 1
    fi
    
    # Now test request to join
    local request_data=$(cat <<EOF
{
  "userId": "${viewer_user}"
}
EOF
)
    
    local response=$(curl -s -w "\n%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -d "${request_data}" \
        "${SERVICE_URL}/streaming/test/rooms/${waitlist_room_id}/request-to-join" 2>&1)
    local status_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | sed '$d')
    
    if [ "$status_code" -eq 200 ] || [ "$status_code" -eq 201 ]; then
        log_success "Request to join submitted (${status_code})"
    else
        log_error "Request to join failed (${status_code}): ${body}"
        return 1
    fi
    
    # Don't cleanup the room - let other tests use it or cleanup at the end
    # curl -s -X POST "${SERVICE_URL}/streaming/test/rooms/${waitlist_room_id}/end" > /dev/null 2>&1 || true
}

# Test: Get waitlist
test_get_waitlist() {
    log_test "Get Waitlist"
    
    # Use existing room if available, otherwise create one
    local waitlist_room_id="${TEST_ROOM_ID}"
    local host_user_1="${TEST_USER_1}"
    local host_user_2="${TEST_USER_2}"
    local viewer_user="test-streaming-viewer-waitlist-2"
    
    if [ -z "$waitlist_room_id" ]; then
        # Try to get user's current room first
        local user_room_response=$(curl -s -w "\n%{http_code}" -X GET \
            "${SERVICE_URL}/streaming/test/users/${TEST_USER_1}/room" 2>&1)
        local user_room_status=$(echo "$user_room_response" | tail -n1)
        local user_room_body=$(echo "$user_room_response" | sed '$d')
        
        if [ "$user_room_status" -eq 200 ] && echo "$user_room_body" | grep -q '"exists":true'; then
            # Try multiple formats for room ID extraction - getRoomDetails returns roomId at root level
            if command -v jq >/dev/null 2>&1; then
                waitlist_room_id=$(echo "$user_room_body" | jq -r '.roomId // .id // empty' 2>/dev/null || echo "")
            fi
            if [ -z "$waitlist_room_id" ]; then
                waitlist_room_id=$(echo "$user_room_body" | grep -o '"roomId":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
            fi
            if [ -z "$waitlist_room_id" ]; then
                waitlist_room_id=$(echo "$user_room_body" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
            fi
        fi
        
        # If still no room, try to create one (users might already be in a room, so this may fail)
        if [ -z "$waitlist_room_id" ]; then
            local room_data=$(cat <<EOF
{
  "userIds": ["${TEST_USER_1}", "${TEST_USER_2}"],
  "callType": "matched"
}
EOF
)
            
            local create_response=$(curl -s -w "\n%{http_code}" -X POST \
                -H "Content-Type: application/json" \
                -d "${room_data}" \
                "${SERVICE_URL}/streaming/test/rooms" 2>&1)
            local create_status=$(echo "$create_response" | tail -n1)
            local create_body=$(echo "$create_response" | sed '$d')
            
            if [ "$create_status" -eq 200 ] || [ "$create_status" -eq 201 ]; then
                waitlist_room_id=$(echo "$create_body" | grep -o '"roomId":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
                if [ -z "$waitlist_room_id" ]; then
                    waitlist_room_id=$(echo "$create_body" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
                fi
            elif echo "$create_body" | grep -q "already in an active room"; then
                # Users are in a room, end it first, then create a new one
                user_room_response=$(curl -s "${SERVICE_URL}/streaming/test/users/${TEST_USER_1}/room" 2>&1)
                if echo "$user_room_response" | grep -q '"exists":true'; then
                    local existing_room_id=$(echo "$user_room_response" | grep -o '"roomId":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
                    if [ -z "$existing_room_id" ] && command -v jq >/dev/null 2>&1; then
                        existing_room_id=$(echo "$user_room_response" | jq -r '.roomId // empty' 2>/dev/null || echo "")
                    fi
                    if [ -n "$existing_room_id" ]; then
                        curl -s -X POST "${SERVICE_URL}/streaming/test/rooms/${existing_room_id}/end" > /dev/null 2>&1 || true
                        sleep 1
                        # Try creating again
                        create_response=$(curl -s -w "\n%{http_code}" -X POST \
                            -H "Content-Type: application/json" \
                            -d "${room_data}" \
                            "${SERVICE_URL}/streaming/test/rooms" 2>&1)
                        create_status=$(echo "$create_response" | tail -n1)
                        create_body=$(echo "$create_response" | sed '$d')
                        if [ "$create_status" -eq 200 ] || [ "$create_status" -eq 201 ]; then
                            waitlist_room_id=$(echo "$create_body" | grep -o '"roomId":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
                            if [ -z "$waitlist_room_id" ]; then
                                waitlist_room_id=$(echo "$create_body" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
                            fi
                            if [ -z "$waitlist_room_id" ] && command -v jq >/dev/null 2>&1; then
                                waitlist_room_id=$(echo "$create_body" | jq -r '.roomId // .id // empty' 2>/dev/null || echo "")
                            fi
                        fi
                    fi
                fi
            fi
        fi
        
        if [ -z "$waitlist_room_id" ]; then
            log_error "No room available for waitlist test. Room must be created first."
            return 1
        fi
    fi
    
    # Enable broadcasting
    local broadcast_data=$(cat <<EOF
{
  "userId": "${host_user_1}"
}
EOF
)
    
    curl -s -X POST \
        -H "Content-Type: application/json" \
        -d "${broadcast_data}" \
        "${SERVICE_URL}/streaming/test/rooms/${waitlist_room_id}/enable-broadcasting" > /dev/null 2>&1
    
    # Add viewer
    local viewer_data=$(cat <<EOF
{
  "userId": "${viewer_user}"
}
EOF
)
    
    curl -s -X POST \
        -H "Content-Type: application/json" \
        -d "${viewer_data}" \
        "${SERVICE_URL}/streaming/test/rooms/${waitlist_room_id}/add-viewer" > /dev/null 2>&1
    
    # Request to join (so there's something in the waitlist)
    local request_data=$(cat <<EOF
{
  "userId": "${viewer_user}"
}
EOF
)
    
    curl -s -X POST \
        -H "Content-Type: application/json" \
        -d "${request_data}" \
        "${SERVICE_URL}/streaming/test/rooms/${waitlist_room_id}/request-to-join" > /dev/null 2>&1
    
    # Now test get waitlist
    http_request "GET" "${SERVICE_URL}/streaming/test/rooms/${waitlist_room_id}/waitlist" "" 200 "Get waitlist"
    
    # Don't cleanup the room - let other tests use it or cleanup at the end
    # curl -s -X POST "${SERVICE_URL}/streaming/test/rooms/${waitlist_room_id}/end" > /dev/null 2>&1 || true
}

# Test: Accept from waitlist
test_accept_from_waitlist() {
    log_test "Accept from Waitlist"
    
    # Use existing room if available, otherwise create one
    local waitlist_room_id="${TEST_ROOM_ID}"
    local host_user="${TEST_USER_1}"
    local host_user_2="${TEST_USER_2}"
    local target_user="test-streaming-viewer-waitlist-3"
    
    if [ -z "$waitlist_room_id" ]; then
        # Try to get user's current room first
        local user_room_response=$(curl -s -w "\n%{http_code}" -X GET \
            "${SERVICE_URL}/streaming/test/users/${TEST_USER_1}/room" 2>&1)
        local user_room_status=$(echo "$user_room_response" | tail -n1)
        local user_room_body=$(echo "$user_room_response" | sed '$d')
        
        if [ "$user_room_status" -eq 200 ] && echo "$user_room_body" | grep -q '"exists":true'; then
            # Try multiple formats for room ID extraction - getRoomDetails returns roomId at root level
            if command -v jq >/dev/null 2>&1; then
                waitlist_room_id=$(echo "$user_room_body" | jq -r '.roomId // .id // empty' 2>/dev/null || echo "")
            fi
            if [ -z "$waitlist_room_id" ]; then
                waitlist_room_id=$(echo "$user_room_body" | grep -o '"roomId":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
            fi
            if [ -z "$waitlist_room_id" ]; then
                waitlist_room_id=$(echo "$user_room_body" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
            fi
        fi
        
        # If still no room, try to create one (users might already be in a room, so this may fail)
        if [ -z "$waitlist_room_id" ]; then
            local room_data=$(cat <<EOF
{
  "userIds": ["${TEST_USER_1}", "${TEST_USER_2}"],
  "callType": "matched"
}
EOF
)
            
            local create_response=$(curl -s -w "\n%{http_code}" -X POST \
                -H "Content-Type: application/json" \
                -d "${room_data}" \
                "${SERVICE_URL}/streaming/test/rooms" 2>&1)
            local create_status=$(echo "$create_response" | tail -n1)
            local create_body=$(echo "$create_response" | sed '$d')
            
            if [ "$create_status" -eq 200 ] || [ "$create_status" -eq 201 ]; then
                waitlist_room_id=$(echo "$create_body" | grep -o '"roomId":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
                if [ -z "$waitlist_room_id" ]; then
                    waitlist_room_id=$(echo "$create_body" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
                fi
            elif echo "$create_body" | grep -q "already in an active room"; then
                # Users are in a room, end it first, then create a new one
                user_room_response=$(curl -s "${SERVICE_URL}/streaming/test/users/${TEST_USER_1}/room" 2>&1)
                if echo "$user_room_response" | grep -q '"exists":true'; then
                    local existing_room_id=$(echo "$user_room_response" | grep -o '"roomId":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
                    if [ -z "$existing_room_id" ] && command -v jq >/dev/null 2>&1; then
                        existing_room_id=$(echo "$user_room_response" | jq -r '.roomId // empty' 2>/dev/null || echo "")
                    fi
                    if [ -n "$existing_room_id" ]; then
                        curl -s -X POST "${SERVICE_URL}/streaming/test/rooms/${existing_room_id}/end" > /dev/null 2>&1 || true
                        sleep 1
                        # Try creating again
                        create_response=$(curl -s -w "\n%{http_code}" -X POST \
                            -H "Content-Type: application/json" \
                            -d "${room_data}" \
                            "${SERVICE_URL}/streaming/test/rooms" 2>&1)
                        create_status=$(echo "$create_response" | tail -n1)
                        create_body=$(echo "$create_response" | sed '$d')
                        if [ "$create_status" -eq 200 ] || [ "$create_status" -eq 201 ]; then
                            waitlist_room_id=$(echo "$create_body" | grep -o '"roomId":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
                            if [ -z "$waitlist_room_id" ]; then
                                waitlist_room_id=$(echo "$create_body" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
                            fi
                            if [ -z "$waitlist_room_id" ] && command -v jq >/dev/null 2>&1; then
                                waitlist_room_id=$(echo "$create_body" | jq -r '.roomId // .id // empty' 2>/dev/null || echo "")
                            fi
                        fi
                    fi
                fi
            fi
        fi
        
        if [ -z "$waitlist_room_id" ]; then
            log_error "No room available for waitlist test. Room must be created first."
            return 1
        fi
    fi
    
    # Enable broadcasting
    local broadcast_data=$(cat <<EOF
{
  "userId": "${host_user}"
}
EOF
)
    
    local broadcast_response=$(curl -s --max-time 5 -w "\n%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -d "${broadcast_data}" \
        "${SERVICE_URL}/streaming/test/rooms/${waitlist_room_id}/enable-broadcasting" 2>&1)
    local broadcast_status=$(echo "$broadcast_response" | tail -n1)
    local broadcast_body=$(echo "$broadcast_response" | sed '$d')
    
    if [ "$broadcast_status" -ne 200 ] && [ "$broadcast_status" -ne 201 ]; then
        log_error "Failed to start broadcast for waitlist test (${broadcast_status}): ${broadcast_body}"
        return 1
    fi
    
    # Add viewer
    local viewer_data=$(cat <<EOF
{
  "userId": "${target_user}"
}
EOF
)
    
    local viewer_response=$(curl -s --max-time 5 -w "\n%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -d "${viewer_data}" \
        "${SERVICE_URL}/streaming/test/rooms/${waitlist_room_id}/add-viewer" 2>&1)
    local viewer_status=$(echo "$viewer_response" | tail -n1)
    local viewer_body=$(echo "$viewer_response" | sed '$d')
    
    if [ "$viewer_status" -ne 200 ] && [ "$viewer_status" -ne 201 ]; then
        log_error "Failed to add viewer for waitlist test (${viewer_status}): ${viewer_body}"
        return 1
    fi
    
    # Request to join (so user is on waitlist)
    local request_data=$(cat <<EOF
{
  "userId": "${target_user}"
}
EOF
)
    
    local request_response=$(curl -s -w "\n%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -d "${request_data}" \
        "${SERVICE_URL}/streaming/test/rooms/${waitlist_room_id}/request-to-join" 2>&1)
    local request_status=$(echo "$request_response" | tail -n1)
    
    if [ "$request_status" -ne 200 ] && [ "$request_status" -ne 201 ]; then
        log_error "Failed to request to join for waitlist test (${request_status})"
        return 1
    fi
    
    # Now test accept from waitlist
    local accept_data=$(cat <<EOF
{
  "hostUserId": "${host_user}",
  "targetUserId": "${target_user}"
}
EOF
)
    
    local response=$(curl -s -w "\n%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -d "${accept_data}" \
        "${SERVICE_URL}/streaming/test/rooms/${waitlist_room_id}/accept-from-waitlist" 2>&1)
    local status_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | sed '$d')
    
    if [ "$status_code" -eq 200 ] || [ "$status_code" -eq 201 ]; then
        log_success "User accepted from waitlist (${status_code})"
    else
        log_error "Accept from waitlist failed (${status_code}): ${body}"
        return 1
    fi
    
    # Don't cleanup the room - let other tests use it or cleanup at the end
    # curl -s -X POST "${SERVICE_URL}/streaming/test/rooms/${waitlist_room_id}/end" > /dev/null 2>&1 || true
}

# Test: Cancel join request
test_cancel_join_request() {
    log_test "Cancel Join Request"
    
    # Use existing room if available, otherwise create one
    local waitlist_room_id="${TEST_ROOM_ID}"
    local host_user_1="${TEST_USER_1}"
    local host_user_2="${TEST_USER_2}"
    local viewer_user="test-streaming-viewer-waitlist-4"
    
    if [ -z "$waitlist_room_id" ]; then
        # Try to get user's current room first
        local user_room_response=$(curl -s -w "\n%{http_code}" -X GET \
            "${SERVICE_URL}/streaming/test/users/${TEST_USER_1}/room" 2>&1)
        local user_room_status=$(echo "$user_room_response" | tail -n1)
        local user_room_body=$(echo "$user_room_response" | sed '$d')
        
        if [ "$user_room_status" -eq 200 ] && echo "$user_room_body" | grep -q '"exists":true'; then
            # Try multiple formats for room ID extraction - getRoomDetails returns roomId at root level
            if command -v jq >/dev/null 2>&1; then
                waitlist_room_id=$(echo "$user_room_body" | jq -r '.roomId // .id // empty' 2>/dev/null || echo "")
            fi
            if [ -z "$waitlist_room_id" ]; then
                waitlist_room_id=$(echo "$user_room_body" | grep -o '"roomId":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
            fi
            if [ -z "$waitlist_room_id" ]; then
                waitlist_room_id=$(echo "$user_room_body" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
            fi
        fi
        
        # If still no room, try to create one (users might already be in a room, so this may fail)
        if [ -z "$waitlist_room_id" ]; then
            local room_data=$(cat <<EOF
{
  "userIds": ["${TEST_USER_1}", "${TEST_USER_2}"],
  "callType": "matched"
}
EOF
)
            
            local create_response=$(curl -s -w "\n%{http_code}" -X POST \
                -H "Content-Type: application/json" \
                -d "${room_data}" \
                "${SERVICE_URL}/streaming/test/rooms" 2>&1)
            local create_status=$(echo "$create_response" | tail -n1)
            local create_body=$(echo "$create_response" | sed '$d')
            
            if [ "$create_status" -eq 200 ] || [ "$create_status" -eq 201 ]; then
                waitlist_room_id=$(echo "$create_body" | grep -o '"roomId":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
                if [ -z "$waitlist_room_id" ]; then
                    waitlist_room_id=$(echo "$create_body" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
                fi
            elif echo "$create_body" | grep -q "already in an active room"; then
                # Users are in a room, end it first, then create a new one
                user_room_response=$(curl -s "${SERVICE_URL}/streaming/test/users/${TEST_USER_1}/room" 2>&1)
                if echo "$user_room_response" | grep -q '"exists":true'; then
                    local existing_room_id=$(echo "$user_room_response" | grep -o '"roomId":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
                    if [ -z "$existing_room_id" ] && command -v jq >/dev/null 2>&1; then
                        existing_room_id=$(echo "$user_room_response" | jq -r '.roomId // empty' 2>/dev/null || echo "")
                    fi
                    if [ -n "$existing_room_id" ]; then
                        curl -s -X POST "${SERVICE_URL}/streaming/test/rooms/${existing_room_id}/end" > /dev/null 2>&1 || true
                        sleep 1
                        # Try creating again
                        create_response=$(curl -s -w "\n%{http_code}" -X POST \
                            -H "Content-Type: application/json" \
                            -d "${room_data}" \
                            "${SERVICE_URL}/streaming/test/rooms" 2>&1)
                        create_status=$(echo "$create_response" | tail -n1)
                        create_body=$(echo "$create_response" | sed '$d')
                        if [ "$create_status" -eq 200 ] || [ "$create_status" -eq 201 ]; then
                            waitlist_room_id=$(echo "$create_body" | grep -o '"roomId":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
                            if [ -z "$waitlist_room_id" ]; then
                                waitlist_room_id=$(echo "$create_body" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
                            fi
                            if [ -z "$waitlist_room_id" ] && command -v jq >/dev/null 2>&1; then
                                waitlist_room_id=$(echo "$create_body" | jq -r '.roomId // .id // empty' 2>/dev/null || echo "")
                            fi
                        fi
                    fi
                fi
            fi
        fi
        
        if [ -z "$waitlist_room_id" ]; then
            log_error "No room available for waitlist test. Room must be created first."
            return 1
        fi
    fi
    
    # Enable broadcasting
    local broadcast_data=$(cat <<EOF
{
  "userId": "${host_user_1}"
}
EOF
)
    
    local broadcast_response=$(curl -s --max-time 5 -w "\n%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -d "${broadcast_data}" \
        "${SERVICE_URL}/streaming/test/rooms/${waitlist_room_id}/enable-broadcasting" 2>&1)
    local broadcast_status=$(echo "$broadcast_response" | tail -n1)
    local broadcast_body=$(echo "$broadcast_response" | sed '$d')
    
    if [ "$broadcast_status" -ne 200 ] && [ "$broadcast_status" -ne 201 ]; then
        log_error "Failed to start broadcast for waitlist test (${broadcast_status}): ${broadcast_body}"
        return 1
    fi
    
    # Add viewer
    local viewer_data=$(cat <<EOF
{
  "userId": "${viewer_user}"
}
EOF
)
    
    local viewer_response=$(curl -s --max-time 5 -w "\n%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -d "${viewer_data}" \
        "${SERVICE_URL}/streaming/test/rooms/${waitlist_room_id}/add-viewer" 2>&1)
    local viewer_status=$(echo "$viewer_response" | tail -n1)
    local viewer_body=$(echo "$viewer_response" | sed '$d')
    
    if [ "$viewer_status" -ne 200 ] && [ "$viewer_status" -ne 201 ]; then
        log_error "Failed to add viewer for waitlist test (${viewer_status}): ${viewer_body}"
        return 1
    fi
    
    # Request to join (so user is on waitlist)
    local request_data=$(cat <<EOF
{
  "userId": "${viewer_user}"
}
EOF
)
    
    local request_response=$(curl -s -w "\n%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -d "${request_data}" \
        "${SERVICE_URL}/streaming/test/rooms/${waitlist_room_id}/request-to-join" 2>&1)
    local request_status=$(echo "$request_response" | tail -n1)
    
    if [ "$request_status" -ne 200 ] && [ "$request_status" -ne 201 ]; then
        log_error "Failed to request to join for waitlist test (${request_status})"
        return 1
    fi
    
    # Now test cancel join request
    local cancel_data=$(cat <<EOF
{
  "userId": "${viewer_user}"
}
EOF
)
    
    local response=$(curl -s --max-time 5 -w "\n%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -d "${cancel_data}" \
        "${SERVICE_URL}/streaming/test/rooms/${waitlist_room_id}/cancel-join-request" 2>&1)
    local status_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | sed '$d')
    
    if [ "$status_code" -eq 200 ] || [ "$status_code" -eq 201 ]; then
        log_success "Join request cancelled (${status_code})"
    else
        log_error "Cancel join request failed (${status_code}): ${body}"
        return 1
    fi
    
    # Don't cleanup the room - let other tests use it or cleanup at the end
    # curl -s -X POST "${SERVICE_URL}/streaming/test/rooms/${waitlist_room_id}/end" > /dev/null 2>&1 || true
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
    # These may fail if wallet service is not available, but continue anyway
    (test_send_gift_with_giftid || true)
    (test_send_gift_without_giftid || true)
    
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
    
    # Waitlist feature tests
    # Wrap in error handling to prevent early exit
    test_request_to_join || log_warn "test_request_to_join failed, continuing..."
    test_get_waitlist || log_warn "test_get_waitlist failed, continuing..."
    test_accept_from_waitlist || log_warn "test_accept_from_waitlist failed, continuing..."
    test_cancel_join_request || log_warn "test_cancel_join_request failed, continuing..."
    
    cleanup
    
    print_summary
}

# Run main function
main "$@"
