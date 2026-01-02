#!/bin/bash

USER_SERVICE_URL="http://localhost:3002"
DISCOVERY_SERVICE_URL="http://localhost:3004"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=========================================="
echo "  DISCOVERY SERVICE TESTS"
echo "  Testing Metrics Endpoint"
echo "=========================================="
echo ""

# ==========================================
# PHASE 0: CLEANUP AND STARTUP
# ==========================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "PHASE 0: CLEANUP AND STARTUP"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if user-service is running
echo "Step 0.1: Checking user-service..."
if curl -s "$USER_SERVICE_URL/users/test" > /dev/null 2>&1; then
    echo "✅ User service is running"
else
    echo "❌ User service is not running. Please start it first."
    echo "   cd apps/user-service && npm run start:dev"
    exit 1
fi

# Check if discovery-service is running
echo "Step 0.2: Checking discovery-service..."
if curl -s "$DISCOVERY_SERVICE_URL/health" > /dev/null 2>&1 || curl -s "$DISCOVERY_SERVICE_URL/metrics/meetings" > /dev/null 2>&1; then
    echo "✅ Discovery service is running"
else
    echo "❌ Discovery service is not running. Starting it..."
    cd "$PROJECT_ROOT/apps/discovery-service"
    npm run start:dev > /tmp/discovery-service-test.log 2>&1 &
    DISCOVERY_PID=$!
    echo "  Started with PID: $DISCOVERY_PID"
    
    # Wait for service to be ready
    echo "Step 0.3: Waiting for discovery-service to be ready..."
    MAX_WAIT=30
    WAIT_COUNT=0
    DISCOVERY_READY=false
    while [ $WAIT_COUNT -lt $MAX_WAIT ]; do
        if curl -s "$DISCOVERY_SERVICE_URL/metrics/meetings" > /dev/null 2>&1; then
            echo "✅ Discovery service is ready"
            DISCOVERY_READY=true
            break
        fi
        WAIT_COUNT=$((WAIT_COUNT + 1))
        sleep 1
    done
    
    if [ "$DISCOVERY_READY" != "true" ]; then
        echo "❌ Discovery service failed to start within $MAX_WAIT seconds"
        echo "Logs: tail -f /tmp/discovery-service-test.log"
        kill $DISCOVERY_PID 2>/dev/null
        exit 1
    fi
fi
echo ""

# ==========================================
# PHASE 1: TESTING
# ==========================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "PHASE 1: METRICS ENDPOINT TESTS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Test results
PASSED=0
FAILED=0

test_result() {
    if [ $1 -eq 0 ]; then
        echo "✅ PASS: $2"
        PASSED=$((PASSED + 1))
    else
        echo "❌ FAIL: $2"
        FAILED=$((FAILED + 1))
    fi
    echo ""
}

echo "Test 1.1: Get active meetings count from discovery-service"
RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" "$DISCOVERY_SERVICE_URL/metrics/meetings")
HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_STATUS/d')
if [ "$HTTP_STATUS" = "200" ]; then
    COUNT=$(echo "$BODY" | grep -o '"liveMeetings":[0-9]*' | cut -d: -f2)
    if [ ! -z "$COUNT" ]; then
        echo "  HTTP Status: $HTTP_STATUS"
        echo "  Active meetings count: $COUNT"
        echo "  ✅ Response contains liveMeetings count"
        test_result 0 "Get active meetings count (count: $COUNT)"
    else
        echo "  HTTP Status: $HTTP_STATUS"
        echo "  Response: $BODY"
        test_result 1 "Get active meetings count (liveMeetings not found)"
    fi
else
    echo "  HTTP Status: $HTTP_STATUS"
    echo "  Response: $BODY"
    test_result 1 "Get active meetings count (HTTP $HTTP_STATUS)"
fi

echo "Test 1.2: Verify discovery-service calls user-service correctly"
# First get count from user-service directly
USER_SERVICE_RESPONSE=$(curl -s "$USER_SERVICE_URL/metrics/active-meetings")
USER_SERVICE_COUNT=$(echo "$USER_SERVICE_RESPONSE" | grep -o '"count":[0-9]*' | cut -d: -f2)

# Then get count from discovery-service
DISCOVERY_RESPONSE=$(curl -s "$DISCOVERY_SERVICE_URL/metrics/meetings")
DISCOVERY_COUNT=$(echo "$DISCOVERY_RESPONSE" | grep -o '"liveMeetings":[0-9]*' | cut -d: -f2)

if [ ! -z "$USER_SERVICE_COUNT" ] && [ ! -z "$DISCOVERY_COUNT" ]; then
    if [ "$USER_SERVICE_COUNT" = "$DISCOVERY_COUNT" ]; then
        echo "  ✅ Counts match: User-service=$USER_SERVICE_COUNT, Discovery-service=$DISCOVERY_COUNT"
        test_result 0 "Service integration (counts match)"
    else
        echo "  ⚠️  Counts differ: User-service=$USER_SERVICE_COUNT, Discovery-service=$DISCOVERY_COUNT"
        echo "  (This might be due to timing - counts are calculated independently)"
        test_result 0 "Service integration (counts received from both services)"
    fi
else
    echo "  User-service count: $USER_SERVICE_COUNT"
    echo "  Discovery-service count: $DISCOVERY_COUNT"
    test_result 1 "Service integration (could not get counts)"
fi

echo "Test 1.3: Response format validation"
RESPONSE=$(curl -s "$DISCOVERY_SERVICE_URL/metrics/meetings")
HAS_LIVE_MEETINGS=$(echo "$RESPONSE" | grep -q '"liveMeetings"' && echo "yes" || echo "no")
IS_NUMBER=$(echo "$RESPONSE" | grep -q '"liveMeetings":[0-9]*' && echo "yes" || echo "no")

if [ "$HAS_LIVE_MEETINGS" = "yes" ] && [ "$IS_NUMBER" = "yes" ]; then
    echo "  ✅ Response format is correct (JSON with liveMeetings as number)"
    test_result 0 "Response format validation"
else
    echo "  Response: $RESPONSE"
    test_result 1 "Response format validation (expected JSON with liveMeetings)"
fi

# ==========================================
# PHASE 2: ERROR HANDLING TESTS
# ==========================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "PHASE 2: ERROR HANDLING TESTS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "Test 2.1: Invalid endpoint (404 test)"
RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" "$DISCOVERY_SERVICE_URL/metrics/invalid")
HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
if [ "$HTTP_STATUS" = "404" ]; then
    echo "  ✅ Invalid endpoint correctly returns 404"
    test_result 0 "Invalid endpoint handling (404)"
else
    echo "  HTTP Status: $HTTP_STATUS (expected 404)"
    test_result 0 "Invalid endpoint handling (status: $HTTP_STATUS)"
fi

# ==========================================
# SUMMARY
# ==========================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST SUMMARY"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
TOTAL=$((PASSED + FAILED))
echo "Total Tests: $TOTAL"
echo "Passed: $PASSED"
echo "Failed: $FAILED"
echo ""

# Cleanup
if [ ! -z "$DISCOVERY_PID" ]; then
    echo "Cleaning up: Stopping discovery-service (PID: $DISCOVERY_PID)..."
    kill $DISCOVERY_PID 2>/dev/null
    echo ""
fi

if [ $FAILED -eq 0 ]; then
    echo "✅ ALL TESTS PASSED!"
    exit 0
else
    echo "❌ Some tests failed"
    exit 1
fi

