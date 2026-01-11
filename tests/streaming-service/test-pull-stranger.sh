#!/bin/bash
# Quick test script for Pull Stranger feature (REST API only - runs in ~30 seconds)

STREAMING_SERVICE_URL="http://localhost:3005"
GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

PASSED=0
FAILED=0

test_result() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✅ PASS: $2${NC}"
        ((PASSED++))
    else
        echo -e "${RED}❌ FAIL: $2${NC}"
        ((FAILED++))
    fi
}

TIMESTAMP=$(date +%s)

echo -e "${CYAN}=========================================="
echo -e "  PULL STRANGER TESTS (Quick)"
echo -e "==========================================${NC}"
echo ""

# Test 64: Enable Pull Stranger (HOST only)
echo -e "${CYAN}Test 64: Enable Pull Stranger (HOST only)${NC}"
PULL_STRANGER_ROOM_RESPONSE=$(curl -s -X POST "$STREAMING_SERVICE_URL/streaming/rooms" \
    -H "Content-Type: application/json" \
    -d "{
        \"userIds\": [\"test-pull-host-1-$TIMESTAMP\", \"test-pull-host-2-$TIMESTAMP\"],
        \"callType\": \"matched\"
    }")

PULL_STRANGER_ROOM_ID=$(echo "$PULL_STRANGER_ROOM_RESPONSE" | jq -r '.roomId // empty' 2>/dev/null)
PULL_STRANGER_HOST_ID="test-pull-host-1-$TIMESTAMP"
PULL_STRANGER_PART_ID="test-pull-host-2-$TIMESTAMP"

if [ ! -z "$PULL_STRANGER_ROOM_ID" ] && [ "$PULL_STRANGER_ROOM_ID" != "null" ]; then
    # HOST enables pull stranger mode
    ENABLE_RESPONSE=$(curl -s -X POST "$STREAMING_SERVICE_URL/streaming/rooms/$PULL_STRANGER_ROOM_ID/enable-pull-stranger" \
        -H "Content-Type: application/json" \
        -d "{\"userId\": \"$PULL_STRANGER_HOST_ID\"}")
    
    ENABLE_SUCCESS=$(echo "$ENABLE_RESPONSE" | jq -r '.success // false' 2>/dev/null)
    
    if [ "$ENABLE_SUCCESS" = "true" ]; then
        test_result 0 "Pull stranger mode enabled successfully by HOST"
    else
        test_result 1 "Failed to enable pull stranger mode"
        echo "  Response: $ENABLE_RESPONSE"
    fi
    
    # Test: Non-HOST cannot enable pull stranger
    PART_ENABLE_RESPONSE=$(curl -s -X POST "$STREAMING_SERVICE_URL/streaming/rooms/$PULL_STRANGER_ROOM_ID/enable-pull-stranger" \
        -H "Content-Type: application/json" \
        -d "{\"userId\": \"$PULL_STRANGER_PART_ID\"}")
    
    PART_ENABLE_ERROR=$(echo "$PART_ENABLE_RESPONSE" | jq -r '.error // .message // empty' 2>/dev/null)
    
    if [ ! -z "$PART_ENABLE_ERROR" ]; then
        test_result 0 "Non-HOST correctly rejected when enabling pull stranger"
    else
        test_result 1 "Non-HOST was able to enable pull stranger (should have been rejected)"
    fi
else
    test_result 1 "Failed to create room for pull stranger test"
fi
echo ""

# Test 65: Join Via Pull Stranger
echo -e "${CYAN}Test 65: Join Via Pull Stranger${NC}"
if [ ! -z "$PULL_STRANGER_ROOM_ID" ] && [ "$PULL_STRANGER_ROOM_ID" != "null" ]; then
    JOINING_USER_ID="test-pull-join-1-$TIMESTAMP"
    
    # Enable pull stranger again (disabled in previous test if participant tried to enable)
    curl -s -X POST "$STREAMING_SERVICE_URL/streaming/rooms/$PULL_STRANGER_ROOM_ID/enable-pull-stranger" \
        -H "Content-Type: application/json" \
        -d "{\"userId\": \"$PULL_STRANGER_HOST_ID\"}" > /dev/null
    sleep 1
    
    # New user joins via pull stranger (targeting HOST)
    JOIN_RESPONSE=$(curl -s -X POST "$STREAMING_SERVICE_URL/streaming/rooms/$PULL_STRANGER_ROOM_ID/join-via-pull-stranger" \
        -H "Content-Type: application/json" \
        -d "{
            \"joiningUserId\": \"$JOINING_USER_ID\",
            \"targetUserId\": \"$PULL_STRANGER_HOST_ID\"
        }")
    
    JOIN_SUCCESS=$(echo "$JOIN_RESPONSE" | jq -r '.success // false' 2>/dev/null)
    
    if [ "$JOIN_SUCCESS" = "true" ]; then
        # Verify user is in room
        ROOM_INFO=$(curl -s "$STREAMING_SERVICE_URL/streaming/rooms/$PULL_STRANGER_ROOM_ID")
        PARTICIPANT_COUNT=$(echo "$ROOM_INFO" | jq -r '.participantCount // 0' 2>/dev/null)
        
        if [ "$PARTICIPANT_COUNT" = "3" ]; then
            test_result 0 "User joined room via pull stranger (participant count: 3)"
        else
            test_result 1 "User joined but participant count incorrect (expected: 3, got: $PARTICIPANT_COUNT)"
        fi
    else
        test_result 1 "Failed to join room via pull stranger"
        echo "  Response: $JOIN_RESPONSE"
    fi
else
    test_result 1 "Skipped: Previous test failed"
fi
echo ""

# Test 66: Pull Stranger - Only One Join Per Enable
echo -e "${CYAN}Test 66: Pull Stranger - Only One Join Per Enable${NC}"
SINGLE_JOIN_ROOM_RESPONSE=$(curl -s -X POST "$STREAMING_SERVICE_URL/streaming/rooms" \
    -H "Content-Type: application/json" \
    -d "{
        \"userIds\": [\"test-single-join-host-$TIMESTAMP\", \"test-single-join-part-$TIMESTAMP\"],
        \"callType\": \"matched\"
    }")

SINGLE_JOIN_ROOM_ID=$(echo "$SINGLE_JOIN_ROOM_RESPONSE" | jq -r '.roomId // empty' 2>/dev/null)
SINGLE_JOIN_HOST_ID="test-single-join-host-$TIMESTAMP"

if [ ! -z "$SINGLE_JOIN_ROOM_ID" ] && [ "$SINGLE_JOIN_ROOM_ID" != "null" ]; then
    # Enable pull stranger
    curl -s -X POST "$STREAMING_SERVICE_URL/streaming/rooms/$SINGLE_JOIN_ROOM_ID/enable-pull-stranger" \
        -H "Content-Type: application/json" \
        -d "{\"userId\": \"$SINGLE_JOIN_HOST_ID\"}" > /dev/null
    sleep 1
    
    # First user joins
    FIRST_JOIN_USER="test-single-join-1-$TIMESTAMP"
    FIRST_JOIN_RESPONSE=$(curl -s -X POST "$STREAMING_SERVICE_URL/streaming/rooms/$SINGLE_JOIN_ROOM_ID/join-via-pull-stranger" \
        -H "Content-Type: application/json" \
        -d "{
            \"joiningUserId\": \"$FIRST_JOIN_USER\",
            \"targetUserId\": \"$SINGLE_JOIN_HOST_ID\"
        }")
    
    FIRST_JOIN_SUCCESS=$(echo "$FIRST_JOIN_RESPONSE" | jq -r '.success // false' 2>/dev/null)
    sleep 1
    
    if [ "$FIRST_JOIN_SUCCESS" = "true" ]; then
        # Try to join again (should fail - pull stranger disabled after first join)
        SECOND_JOIN_USER="test-single-join-2-$TIMESTAMP"
        SECOND_JOIN_RESPONSE=$(curl -s -X POST "$STREAMING_SERVICE_URL/streaming/rooms/$SINGLE_JOIN_ROOM_ID/join-via-pull-stranger" \
            -H "Content-Type: application/json" \
            -d "{
                \"joiningUserId\": \"$SECOND_JOIN_USER\",
                \"targetUserId\": \"$SINGLE_JOIN_HOST_ID\"
            }")
        
        SECOND_JOIN_ERROR=$(echo "$SECOND_JOIN_RESPONSE" | jq -r '.error // .message // empty' 2>/dev/null)
        
        if [ ! -z "$SECOND_JOIN_ERROR" ]; then
            test_result 0 "Only one user can join per enable (second join correctly rejected)"
        else
            test_result 1 "Second user was able to join (should have been rejected - pull stranger disabled)"
        fi
    else
        test_result 1 "First join failed - cannot test single join restriction"
    fi
else
    test_result 1 "Failed to create room for single join test"
fi
echo ""

# Test 67: Get Room For Pull Stranger User
echo -e "${CYAN}Test 67: Get Room For Pull Stranger User${NC}"
if [ ! -z "$PULL_STRANGER_ROOM_ID" ] && [ "$PULL_STRANGER_ROOM_ID" != "null" ]; then
    # Enable pull stranger again
    curl -s -X POST "$STREAMING_SERVICE_URL/streaming/rooms/$PULL_STRANGER_ROOM_ID/enable-pull-stranger" \
        -H "Content-Type: application/json" \
        -d "{\"userId\": \"$PULL_STRANGER_HOST_ID\"}" > /dev/null
    sleep 1
    
    # Get room for HOST (should return room ID)
    GET_ROOM_RESPONSE=$(curl -s "$STREAMING_SERVICE_URL/streaming/pull-stranger/room/$PULL_STRANGER_HOST_ID")
    ROOM_EXISTS=$(echo "$GET_ROOM_RESPONSE" | jq -r '.exists // false' 2>/dev/null)
    RETURNED_ROOM_ID=$(echo "$GET_ROOM_RESPONSE" | jq -r '.roomId // empty' 2>/dev/null)
    
    if [ "$ROOM_EXISTS" = "true" ] && [ "$RETURNED_ROOM_ID" = "$PULL_STRANGER_ROOM_ID" ]; then
        test_result 0 "Get room for pull stranger user returns correct room ID"
    else
        test_result 1 "Get room for pull stranger user failed or returned wrong room"
        echo "  Response: $GET_ROOM_RESPONSE"
    fi
    
    # Get room for user not in pull stranger mode (should return exists: false)
    OUTSIDER_USER="test-pull-outsider-$TIMESTAMP"
    GET_OUTSIDER_RESPONSE=$(curl -s "$STREAMING_SERVICE_URL/streaming/pull-stranger/room/$OUTSIDER_USER")
    OUTSIDER_EXISTS=$(echo "$GET_OUTSIDER_RESPONSE" | jq -r '.exists // false' 2>/dev/null)
    
    if [ "$OUTSIDER_EXISTS" = "false" ]; then
        test_result 0 "Get room for user not in pull stranger mode returns exists: false"
    else
        test_result 1 "Get room for outsider user should return exists: false (got: $OUTSIDER_EXISTS)"
        echo "  Response: $GET_OUTSIDER_RESPONSE"
    fi
else
    test_result 1 "Skipped: Previous test failed"
fi
echo ""

# Summary
echo -e "${CYAN}=========================================="
echo -e "  TEST SUMMARY"
echo -e "==========================================${NC}"
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ All pull stranger tests passed!${NC}"
    exit 0
else
    echo -e "${RED}❌ Some tests failed${NC}"
    exit 1
fi
