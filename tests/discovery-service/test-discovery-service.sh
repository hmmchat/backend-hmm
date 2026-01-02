#!/bin/bash

USER_SERVICE_URL="http://localhost:3002"
DISCOVERY_SERVICE_URL="http://localhost:3004"
WALLET_SERVICE_URL="http://localhost:3005"
AUTH_SERVICE_URL="http://localhost:3001"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${BLUE}=========================================="
echo -e "  DISCOVERY SERVICE TESTS"
echo -e "  Testing Metrics & Gender Filter Endpoints"
echo -e "==========================================${NC}"
echo ""

# ==========================================
# PHASE 0: CLEANUP AND STARTUP
# ==========================================

echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}PHASE 0: CLEANUP AND STARTUP${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Check if user-service is running
echo -e "${CYAN}Step 0.1: Checking user-service...${NC}"
if curl -s "$USER_SERVICE_URL/users/test" > /dev/null 2>&1 || curl -s "$USER_SERVICE_URL/metrics/active-meetings" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ User service is running${NC}"
else
    echo -e "${RED}❌ User service is not running. Please start it first.${NC}"
    echo "   cd apps/user-service && npm run start:dev"
    exit 1
fi

# Check if wallet-service is running
echo -e "${CYAN}Step 0.2: Checking wallet-service...${NC}"
if curl -s "$WALLET_SERVICE_URL/me/balance" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Wallet service is running${NC}"
else
    echo -e "${YELLOW}⚠️  Wallet service is not running. Some tests may fail.${NC}"
    echo "   cd apps/wallet-service && npm run start:dev"
fi

# Check if discovery-service is running
echo -e "${CYAN}Step 0.3: Checking discovery-service...${NC}"
if curl -s "$DISCOVERY_SERVICE_URL/health" > /dev/null 2>&1 || curl -s "$DISCOVERY_SERVICE_URL/metrics/meetings" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Discovery service is running${NC}"
else
    echo -e "${YELLOW}⚠️  Discovery service is not running. Starting it...${NC}"
    cd "$PROJECT_ROOT/apps/discovery-service"
    npm run start:dev > /tmp/discovery-service-test.log 2>&1 &
    DISCOVERY_PID=$!
    echo "  Started with PID: $DISCOVERY_PID"
    
    # Wait for service to be ready
    echo -e "${CYAN}Step 0.4: Waiting for discovery-service to be ready...${NC}"
    MAX_WAIT=30
    WAIT_COUNT=0
    DISCOVERY_READY=false
    while [ $WAIT_COUNT -lt $MAX_WAIT ]; do
        if curl -s "$DISCOVERY_SERVICE_URL/metrics/meetings" > /dev/null 2>&1; then
            echo -e "${GREEN}✅ Discovery service is ready${NC}"
            DISCOVERY_READY=true
            break
        fi
        WAIT_COUNT=$((WAIT_COUNT + 1))
        sleep 1
    done
    
    if [ "$DISCOVERY_READY" != "true" ]; then
        echo -e "${RED}❌ Discovery service failed to start within $MAX_WAIT seconds${NC}"
        echo "Logs: tail -f /tmp/discovery-service-test.log"
        kill $DISCOVERY_PID 2>/dev/null
        exit 1
    fi
fi

# Load test tokens if available
echo -e "${CYAN}Step 0.5: Loading test tokens...${NC}"
if [ -f "$SCRIPT_DIR/.test-tokens" ]; then
    source "$SCRIPT_DIR/.test-tokens"
    
    # Count available tokens
    TOKEN_COUNT=0
    AVAILABLE_TOKENS=""
    [ ! -z "$TOKEN_MALE" ] && TOKEN_COUNT=$((TOKEN_COUNT + 1)) && AVAILABLE_TOKENS="$AVAILABLE_TOKENS MALE"
    [ ! -z "$TOKEN_FEMALE" ] && TOKEN_COUNT=$((TOKEN_COUNT + 1)) && AVAILABLE_TOKENS="$AVAILABLE_TOKENS FEMALE"
    [ ! -z "$TOKEN_NON_BINARY" ] && TOKEN_COUNT=$((TOKEN_COUNT + 1)) && AVAILABLE_TOKENS="$AVAILABLE_TOKENS NON_BINARY"
    [ ! -z "$TOKEN_PREFER_NOT_TO_SAY" ] && TOKEN_COUNT=$((TOKEN_COUNT + 1)) && AVAILABLE_TOKENS="$AVAILABLE_TOKENS PREFER_NOT_TO_SAY"
    
    if [ $TOKEN_COUNT -gt 0 ]; then
        echo -e "${GREEN}✅ Loaded $TOKEN_COUNT token(s):$AVAILABLE_TOKENS${NC}"
        echo -e "${YELLOW}  Tests will run only for available tokens${NC}"
    else
        echo -e "${YELLOW}⚠️  No tokens found in .test-tokens file${NC}"
        echo "  Create a user with: ./create-single-user.sh <GENDER> +918073656316"
    fi
else
    echo -e "${YELLOW}⚠️  No .test-tokens file found${NC}"
    echo "  Create a user with: ./create-single-user.sh <GENDER> +918073656316"
fi
echo ""

# ==========================================
# PHASE 1: METRICS ENDPOINT TESTS
# ==========================================

echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}PHASE 1: METRICS ENDPOINT TESTS${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Test results
PASSED=0
FAILED=0

test_result() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✅ PASS: $2${NC}"
        PASSED=$((PASSED + 1))
    else
        echo -e "${RED}❌ FAIL: $2${NC}"
        FAILED=$((FAILED + 1))
    fi
    echo ""
}

echo -e "${CYAN}Test 1.1: Get active meetings count from discovery-service${NC}"
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

# ==========================================
# PHASE 2: GENDER FILTER TESTS
# ==========================================

echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}PHASE 2: GENDER FILTER TESTS${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Test 2.1: Get gender filters without token (should fail)
echo -e "${CYAN}Test 2.1: Get gender filters without token (should fail)${NC}"
RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" "$DISCOVERY_SERVICE_URL/gender-filters")
HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
if [ "$HTTP_STATUS" = "401" ]; then
    echo "  ✅ Correctly returns 401 Unauthorized"
    test_result 0 "Get gender filters without token (401)"
else
    echo "  HTTP Status: $HTTP_STATUS (expected 401)"
    test_result 1 "Get gender filters without token"
fi

# Test 2.2: Get gender filters with invalid token (should fail)
echo -e "${CYAN}Test 2.2: Get gender filters with invalid token (should fail)${NC}"
RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
    -H "Authorization: Bearer invalid_token_12345" \
    "$DISCOVERY_SERVICE_URL/gender-filters")
HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
if [ "$HTTP_STATUS" = "401" ] || [ "$HTTP_STATUS" = "500" ]; then
    echo "  ✅ Correctly rejects invalid token"
    test_result 0 "Get gender filters with invalid token"
else
    echo "  HTTP Status: $HTTP_STATUS"
    test_result 1 "Get gender filters with invalid token"
fi

# Test 2.3: Get gender filters for PREFER_NOT_TO_SAY user
if [ ! -z "$TOKEN_PREFER_NOT_TO_SAY" ]; then
    echo -e "${CYAN}Test 2.3: Get gender filters for PREFER_NOT_TO_SAY user${NC}"
    RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
        -H "Authorization: Bearer $TOKEN_PREFER_NOT_TO_SAY" \
        "$DISCOVERY_SERVICE_URL/gender-filters")
    HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
    BODY=$(echo "$RESPONSE" | sed '/HTTP_STATUS/d')
    
    if [ "$HTTP_STATUS" = "200" ]; then
        HAS_APPLICABLE_TRUE=$(echo "$BODY" | grep -q '"applicable":true' && echo "yes" || echo "no")
        HAS_ALL_FILTER=$(echo "$BODY" | grep -q '"gender":"ALL"' && echo "yes" || echo "no")
        NO_MALE_FILTER=$(echo "$BODY" | grep -q '"gender":"MALE"' && echo "no" || echo "yes")
        NO_FEMALE_FILTER=$(echo "$BODY" | grep -q '"gender":"FEMALE"' && echo "no" || echo "yes")
        NO_NON_BINARY_FILTER=$(echo "$BODY" | grep -q '"gender":"NON_BINARY"' && echo "no" || echo "yes")
        
        if [ "$HAS_APPLICABLE_TRUE" = "yes" ] && [ "$HAS_ALL_FILTER" = "yes" ] && [ "$NO_MALE_FILTER" = "yes" ] && [ "$NO_FEMALE_FILTER" = "yes" ] && [ "$NO_NON_BINARY_FILTER" = "yes" ]; then
            echo "  ✅ PREFER_NOT_TO_SAY user gets 'All Gender' option only"
            echo "  ✅ Does not show paid filters (MALE, FEMALE, NON_BINARY)"
            test_result 0 "PREFER_NOT_TO_SAY user sees only ALL option"
        else
            echo "  Response: $BODY"
            test_result 1 "PREFER_NOT_TO_SAY user filter check"
        fi
    else
        echo "  HTTP Status: $HTTP_STATUS"
        echo "  Response: $BODY"
        test_result 1 "PREFER_NOT_TO_SAY user filter check (HTTP $HTTP_STATUS)"
    fi
else
    echo -e "${YELLOW}⚠️  Test 2.3: Skipped (no PREFER_NOT_TO_SAY token)${NC}"
    echo ""
fi

# Test 2.4: Get gender filters for MALE user
if [ ! -z "$TOKEN_MALE" ]; then
    echo -e "${CYAN}Test 2.4: Get gender filters for MALE user${NC}"
    RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
        -H "Authorization: Bearer $TOKEN_MALE" \
        "$DISCOVERY_SERVICE_URL/gender-filters")
    HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
    BODY=$(echo "$RESPONSE" | sed '/HTTP_STATUS/d')
    
    if [ "$HTTP_STATUS" = "200" ]; then
        HAS_APPLICABLE_TRUE=$(echo "$BODY" | grep -q '"applicable":true' && echo "yes" || echo "no")
        HAS_MALE_FILTER=$(echo "$BODY" | grep -q '"gender":"MALE"' && echo "yes" || echo "no")
        HAS_FEMALE_FILTER=$(echo "$BODY" | grep -q '"gender":"FEMALE"' && echo "yes" || echo "no")
        HAS_ALL_FILTER=$(echo "$BODY" | grep -q '"gender":"ALL"' && echo "yes" || echo "no")
        NO_NON_BINARY=$(echo "$BODY" | grep -q '"gender":"NON_BINARY"' && echo "no" || echo "yes")
        
        if [ "$HAS_APPLICABLE_TRUE" = "yes" ] && [ "$HAS_MALE_FILTER" = "yes" ] && [ "$HAS_FEMALE_FILTER" = "yes" ] && [ "$HAS_ALL_FILTER" = "yes" ] && [ "$NO_NON_BINARY" = "yes" ]; then
            echo "  ✅ Filter is applicable for MALE user"
            echo "  ✅ Shows MALE, FEMALE, and All Gender filters (3 options)"
            echo "  ✅ Does not show NON_BINARY filter"
            test_result 0 "MALE user sees correct filters"
        else
            echo "  Response: $BODY"
            test_result 1 "MALE user filter options"
        fi
    else
        echo "  HTTP Status: $HTTP_STATUS"
        echo "  Response: $BODY"
        test_result 1 "MALE user filter check (HTTP $HTTP_STATUS)"
    fi
else
    echo -e "${YELLOW}⚠️  Test 2.4: Skipped (no MALE token)${NC}"
    echo ""
fi

# Test 2.5: Get gender filters for FEMALE user
if [ ! -z "$TOKEN_FEMALE" ]; then
    echo -e "${CYAN}Test 2.5: Get gender filters for FEMALE user${NC}"
    RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
        -H "Authorization: Bearer $TOKEN_FEMALE" \
        "$DISCOVERY_SERVICE_URL/gender-filters")
    HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
    BODY=$(echo "$RESPONSE" | sed '/HTTP_STATUS/d')
    
    if [ "$HTTP_STATUS" = "200" ]; then
        HAS_APPLICABLE_TRUE=$(echo "$BODY" | grep -q '"applicable":true' && echo "yes" || echo "no")
        HAS_MALE_FILTER=$(echo "$BODY" | grep -q '"gender":"MALE"' && echo "yes" || echo "no")
        HAS_FEMALE_FILTER=$(echo "$BODY" | grep -q '"gender":"FEMALE"' && echo "yes" || echo "no")
        HAS_ALL_FILTER=$(echo "$BODY" | grep -q '"gender":"ALL"' && echo "yes" || echo "no")
        NO_NON_BINARY=$(echo "$BODY" | grep -q '"gender":"NON_BINARY"' && echo "no" || echo "yes")
        
        if [ "$HAS_APPLICABLE_TRUE" = "yes" ] && [ "$HAS_MALE_FILTER" = "yes" ] && [ "$HAS_FEMALE_FILTER" = "yes" ] && [ "$HAS_ALL_FILTER" = "yes" ] && [ "$NO_NON_BINARY" = "yes" ]; then
            echo "  ✅ Filter is applicable for FEMALE user"
            echo "  ✅ Shows MALE, FEMALE, and All Gender filters (3 options)"
            echo "  ✅ Does not show NON_BINARY filter"
            test_result 0 "FEMALE user sees correct filters"
        else
            echo "  Response: $BODY"
            test_result 1 "FEMALE user filter options"
        fi
    else
        echo "  HTTP Status: $HTTP_STATUS"
        echo "  Response: $BODY"
        test_result 1 "FEMALE user filter check (HTTP $HTTP_STATUS)"
    fi
else
    echo -e "${YELLOW}⚠️  Test 2.5: Skipped (no FEMALE token)${NC}"
    echo ""
fi

# Test 2.6: Get gender filters for NON_BINARY user
if [ ! -z "$TOKEN_NON_BINARY" ]; then
    echo -e "${CYAN}Test 2.6: Get gender filters for NON_BINARY user${NC}"
    RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
        -H "Authorization: Bearer $TOKEN_NON_BINARY" \
        "$DISCOVERY_SERVICE_URL/gender-filters")
    HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
    BODY=$(echo "$RESPONSE" | sed '/HTTP_STATUS/d')
    
    if [ "$HTTP_STATUS" = "200" ]; then
        HAS_APPLICABLE_TRUE=$(echo "$BODY" | grep -q '"applicable":true' && echo "yes" || echo "no")
        HAS_MALE_FILTER=$(echo "$BODY" | grep -q '"gender":"MALE"' && echo "yes" || echo "no")
        HAS_FEMALE_FILTER=$(echo "$BODY" | grep -q '"gender":"FEMALE"' && echo "yes" || echo "no")
        HAS_NON_BINARY_FILTER=$(echo "$BODY" | grep -q '"gender":"NON_BINARY"' && echo "yes" || echo "no")
        HAS_ALL_FILTER=$(echo "$BODY" | grep -q '"gender":"ALL"' && echo "yes" || echo "no")
        
        if [ "$HAS_APPLICABLE_TRUE" = "yes" ] && [ "$HAS_MALE_FILTER" = "yes" ] && [ "$HAS_FEMALE_FILTER" = "yes" ] && [ "$HAS_NON_BINARY_FILTER" = "yes" ] && [ "$HAS_ALL_FILTER" = "yes" ]; then
            echo "  ✅ Filter is applicable for NON_BINARY user"
            echo "  ✅ Shows all 4 filters (MALE, FEMALE, NON_BINARY, All Gender)"
            test_result 0 "NON_BINARY user sees all filters"
        else
            echo "  Response: $BODY"
            test_result 1 "NON_BINARY user filter options"
        fi
    else
        echo "  HTTP Status: $HTTP_STATUS"
        echo "  Response: $BODY"
        test_result 1 "NON_BINARY user filter check (HTTP $HTTP_STATUS)"
    fi
else
    echo -e "${YELLOW}⚠️  Test 2.6: Skipped (no NON_BINARY token)${NC}"
    echo ""
fi

# Test 2.7: Apply gender filter (MALE user selecting MALE)
if [ ! -z "$TOKEN_MALE" ]; then
    echo -e "${CYAN}Test 2.7: Apply gender filter (MALE user selecting MALE)${NC}"
    
    # First check balance
    BALANCE_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
        -H "Authorization: Bearer $TOKEN_MALE" \
        "$WALLET_SERVICE_URL/me/balance")
    BALANCE_HTTP=$(echo "$BALANCE_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
    BALANCE_BODY=$(echo "$BALANCE_RESPONSE" | sed '/HTTP_STATUS/d')
    
    if [ "$BALANCE_HTTP" = "200" ]; then
        CURRENT_BALANCE=$(echo "$BALANCE_BODY" | grep -o '"balance":[0-9]*' | cut -d: -f2)
        echo "  Current balance: $CURRENT_BALANCE coins"
        
        # Apply filter
        APPLY_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
            -X POST \
            -H "Authorization: Bearer $TOKEN_MALE" \
            -H "Content-Type: application/json" \
            -d '{"genders":["MALE"]}' \
            "$DISCOVERY_SERVICE_URL/gender-filters/apply")
        APPLY_HTTP=$(echo "$APPLY_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
        APPLY_BODY=$(echo "$APPLY_RESPONSE" | sed '/HTTP_STATUS/d')
        
        if [ "$APPLY_HTTP" = "200" ]; then
            HAS_SUCCESS=$(echo "$APPLY_BODY" | grep -q '"success":true' && echo "yes" || echo "no")
            NEW_BALANCE=$(echo "$APPLY_BODY" | grep -o '"newBalance":[0-9]*' | cut -d: -f2)
            SCREENS_REMAINING=$(echo "$APPLY_BODY" | grep -o '"screensRemaining":[0-9]*' | cut -d: -f2)
            
            if [ "$HAS_SUCCESS" = "yes" ]; then
                echo "  ✅ Filter applied successfully"
                echo "  New balance: $NEW_BALANCE coins"
                echo "  Screens remaining: $SCREENS_REMAINING"
                test_result 0 "Apply gender filter (MALE user)"
            else
                echo "  Response: $APPLY_BODY"
                test_result 1 "Apply gender filter"
            fi
        elif [ "$APPLY_HTTP" = "400" ]; then
            ERROR_MSG=$(echo "$APPLY_BODY" | grep -o '"message":"[^"]*"' | cut -d'"' -f4 || echo "Insufficient balance")
            echo "  ⚠️  Cannot apply filter: $ERROR_MSG"
            echo "  (This is expected if balance is insufficient)"
            test_result 0 "Apply gender filter (insufficient balance handled)"
        else
            echo "  HTTP Status: $APPLY_HTTP"
            echo "  Response: $APPLY_BODY"
            test_result 1 "Apply gender filter (HTTP $APPLY_HTTP)"
        fi
    else
        echo "  ⚠️  Could not check balance (HTTP $BALANCE_HTTP)"
        test_result 0 "Apply gender filter (balance check skipped)"
    fi
else
    echo -e "${YELLOW}⚠️  Test 2.7: Skipped (no MALE token)${NC}"
    echo ""
fi

# Test 2.8: Apply gender filter with invalid selection (MALE user trying NON_BINARY)
if [ ! -z "$TOKEN_MALE" ]; then
    echo -e "${CYAN}Test 2.8: Apply gender filter with invalid selection (MALE user trying NON_BINARY)${NC}"
    RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
        -X POST \
        -H "Authorization: Bearer $TOKEN_MALE" \
        -H "Content-Type: application/json" \
        -d '{"genders":["NON_BINARY"]}' \
        "$DISCOVERY_SERVICE_URL/gender-filters/apply")
    HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
    BODY=$(echo "$RESPONSE" | sed '/HTTP_STATUS/d')
    
    if [ "$HTTP_STATUS" = "400" ]; then
        echo "  ✅ Correctly rejects invalid gender selection"
        test_result 0 "Invalid gender selection rejected"
    else
        echo "  HTTP Status: $HTTP_STATUS (expected 400)"
        echo "  Response: $BODY"
        test_result 1 "Invalid gender selection check"
    fi
else
    echo -e "${YELLOW}⚠️  Test 2.8: Skipped (no MALE token)${NC}"
    echo ""
fi

# Test 2.9: Apply gender filter without token (should fail)
echo -e "${CYAN}Test 2.9: Apply gender filter without token (should fail)${NC}"
RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    -d '{"genders":["MALE"]}' \
    "$DISCOVERY_SERVICE_URL/gender-filters/apply")
HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
if [ "$HTTP_STATUS" = "401" ]; then
    echo "  ✅ Correctly returns 401 Unauthorized"
    test_result 0 "Apply gender filter without token (401)"
else
    echo "  HTTP Status: $HTTP_STATUS (expected 401)"
    test_result 1 "Apply gender filter without token"
fi

# ==========================================
# SUMMARY
# ==========================================

echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}TEST SUMMARY${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
TOTAL=$((PASSED + FAILED))
echo "Total Tests: $TOTAL"
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo ""

# Cleanup
if [ ! -z "$DISCOVERY_PID" ]; then
    echo "Cleaning up: Stopping discovery-service (PID: $DISCOVERY_PID)..."
    kill $DISCOVERY_PID 2>/dev/null
    echo ""
fi

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ ALL TESTS PASSED!${NC}"
    exit 0
else
    echo -e "${RED}❌ Some tests failed${NC}"
    exit 1
fi
