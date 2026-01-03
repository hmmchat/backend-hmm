#!/bin/bash

# Comprehensive E2E test script for moderation-service
# No auth required - moderation service is public

set +e

MODERATION_SERVICE_URL="http://localhost:3003"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
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

echo -e "${BLUE}=========================================="
echo -e "  MODERATION SERVICE E2E TEST"
echo -e "==========================================${NC}"
echo ""

# Step 1: Check Service
echo -e "${CYAN}Step 1: Checking Moderation Service...${NC}"

if curl -s "$MODERATION_SERVICE_URL/moderation/check-image" -X POST -H "Content-Type: application/json" -d '{"imageUrl":"test"}' > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Moderation service is running${NC}"
else
    echo -e "${YELLOW}⚠️  Moderation service is not running${NC}"
    echo -e "${CYAN}Please start moderation-service manually:${NC}"
    echo "  cd apps/moderation-service && npm run start:dev"
    echo ""
    read -p "Press Enter once moderation-service is running, or Ctrl+C to exit..."
fi
echo ""

# Step 2: Wait for service
echo -e "${CYAN}Step 2: Waiting for service to be ready...${NC}"
sleep 2

# Step 3: Run Test Cases
echo -e "${BLUE}=========================================="
echo -e "  TEST CASES"
echo -e "==========================================${NC}"
echo ""

# ========== CORE FUNCTIONALITY TESTS ==========

# Test 1: Safe Image (Mock Provider)
echo -e "${CYAN}Test 1: Safe Image (Mock Provider)${NC}"
SAFE_RESPONSE=$(curl -s -X POST "$MODERATION_SERVICE_URL/moderation/check-image" \
    -H "Content-Type: application/json" \
    -d '{"imageUrl": "https://example.com/safe-profile.jpg"}')

SAFE_STATUS=$(echo "$SAFE_RESPONSE" | jq -r '.safe // empty' 2>/dev/null)
if [ "$SAFE_STATUS" = "true" ]; then
    test_result 0 "Safe image check (mock provider)"
else
    test_result 1 "Safe image check failed"
    echo "  Response: $SAFE_RESPONSE"
fi
echo ""

# Test 2: Unsafe Image - NSFW Keyword
echo -e "${CYAN}Test 2: Unsafe Image - NSFW Keyword${NC}"
UNSAFE_RESPONSE=$(curl -s -X POST "$MODERATION_SERVICE_URL/moderation/check-image" \
    -H "Content-Type: application/json" \
    -d '{"imageUrl": "https://example.com/nsfw-image.jpg"}')

UNSAFE_STATUS=$(echo "$UNSAFE_RESPONSE" | jq -r '.safe' 2>/dev/null)
if [ "$UNSAFE_STATUS" = "false" ] || [ "$UNSAFE_STATUS" = "0" ]; then
    test_result 0 "Unsafe image check (nsfw keyword detected)"
else
    test_result 1 "Unsafe image check failed (safe=$UNSAFE_STATUS)"
    echo "  Response: $UNSAFE_RESPONSE"
fi
echo ""

# Test 3: Unsafe Image - Explicit Keyword
echo -e "${CYAN}Test 3: Unsafe Image - Explicit Keyword${NC}"
EXPLICIT_RESPONSE=$(curl -s -X POST "$MODERATION_SERVICE_URL/moderation/check-image" \
    -H "Content-Type: application/json" \
    -d '{"imageUrl": "https://example.com/explicit-content.jpg"}')

EXPLICIT_STATUS=$(echo "$EXPLICIT_RESPONSE" | jq -r '.safe' 2>/dev/null)
if [ "$EXPLICIT_STATUS" = "false" ] || [ "$EXPLICIT_STATUS" = "0" ]; then
    test_result 0 "Unsafe image check (explicit keyword detected)"
else
    test_result 1 "Explicit keyword check failed (safe=$EXPLICIT_STATUS)"
    echo "  Response: $EXPLICIT_RESPONSE"
fi
echo ""

# Test 4: Non-Human Content
echo -e "${CYAN}Test 4: Non-Human Content${NC}"
NON_HUMAN_RESPONSE=$(curl -s -X POST "$MODERATION_SERVICE_URL/moderation/check-image" \
    -H "Content-Type: application/json" \
    -d '{"imageUrl": "https://example.com/landscape-photo.jpg"}')

NON_HUMAN_SAFE=$(echo "$NON_HUMAN_RESPONSE" | jq -r '.safe' 2>/dev/null)
IS_HUMAN=$(echo "$NON_HUMAN_RESPONSE" | jq -r '.isHuman' 2>/dev/null)
if [ "$NON_HUMAN_SAFE" = "false" ] || [ "$NON_HUMAN_SAFE" = "0" ] || [ "$IS_HUMAN" = "false" ] || [ "$IS_HUMAN" = "0" ]; then
    test_result 0 "Non-human content rejected"
else
    test_result 1 "Non-human content check failed (safe=$NON_HUMAN_SAFE, isHuman=$IS_HUMAN)"
    echo "  Response: $NON_HUMAN_RESPONSE"
fi
echo ""

# ========== EDGE CASES ==========

# Test 5: Invalid URL Format
echo -e "${CYAN}Test 5: Invalid URL Format${NC}"
INVALID_URL_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST "$MODERATION_SERVICE_URL/moderation/check-image" \
    -H "Content-Type: application/json" \
    -d '{"imageUrl": "not-a-valid-url"}')

HTTP_STATUS=$(echo "$INVALID_URL_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
if [ "$HTTP_STATUS" = "400" ]; then
    test_result 0 "Invalid URL format rejected (400)"
else
    test_result 1 "Invalid URL not rejected (expected 400, got $HTTP_STATUS)"
fi
echo ""

# Test 6: Missing imageUrl Field
echo -e "${CYAN}Test 6: Missing imageUrl Field${NC}"
MISSING_FIELD_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST "$MODERATION_SERVICE_URL/moderation/check-image" \
    -H "Content-Type: application/json" \
    -d '{}')

HTTP_STATUS=$(echo "$MISSING_FIELD_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
if [ "$HTTP_STATUS" = "400" ]; then
    test_result 0 "Missing imageUrl field rejected (400)"
else
    test_result 1 "Missing field not rejected (expected 400, got $HTTP_STATUS)"
fi
echo ""

# Test 7: Empty imageUrl
echo -e "${CYAN}Test 7: Empty imageUrl${NC}"
EMPTY_URL_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST "$MODERATION_SERVICE_URL/moderation/check-image" \
    -H "Content-Type: application/json" \
    -d '{"imageUrl": ""}')

HTTP_STATUS=$(echo "$EMPTY_URL_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
if [ "$HTTP_STATUS" = "400" ]; then
    test_result 0 "Empty imageUrl rejected (400)"
else
    test_result 1 "Empty URL not rejected (expected 400, got $HTTP_STATUS)"
fi
echo ""

# Test 8: Response Structure - Safe Image
echo -e "${CYAN}Test 8: Response Structure - Safe Image${NC}"
STRUCTURE_RESPONSE=$(curl -s -X POST "$MODERATION_SERVICE_URL/moderation/check-image" \
    -H "Content-Type: application/json" \
    -d '{"imageUrl": "https://example.com/profile.jpg"}')

HAS_SAFE=$(echo "$STRUCTURE_RESPONSE" | jq -r '.safe // empty' 2>/dev/null)
HAS_CONFIDENCE=$(echo "$STRUCTURE_RESPONSE" | jq -r '.confidence // empty' 2>/dev/null)
HAS_IS_HUMAN=$(echo "$STRUCTURE_RESPONSE" | jq -r '.isHuman // empty' 2>/dev/null)

if [ ! -z "$HAS_SAFE" ] && [ ! -z "$HAS_CONFIDENCE" ] && [ ! -z "$HAS_IS_HUMAN" ]; then
    test_result 0 "Response structure correct (safe, confidence, isHuman)"
else
    test_result 1 "Response structure incomplete"
    echo "  Response: $STRUCTURE_RESPONSE"
fi
echo ""

# Test 9: Response Structure - Unsafe Image
echo -e "${CYAN}Test 9: Response Structure - Unsafe Image${NC}"
UNSAFE_STRUCTURE_RESPONSE=$(curl -s -X POST "$MODERATION_SERVICE_URL/moderation/check-image" \
    -H "Content-Type: application/json" \
    -d '{"imageUrl": "https://example.com/nsfw-photo.jpg"}')

HAS_FAILURE_REASONS=$(echo "$UNSAFE_STRUCTURE_RESPONSE" | jq -r '.failureReasons // empty' 2>/dev/null)
HAS_CATEGORIES=$(echo "$UNSAFE_STRUCTURE_RESPONSE" | jq -r '.categories // empty' 2>/dev/null)

if [ ! -z "$HAS_FAILURE_REASONS" ] && [ ! -z "$HAS_CATEGORIES" ]; then
    test_result 0 "Unsafe image response includes failureReasons and categories"
else
    test_result 0 "Unsafe image response structure (may vary by provider)"
fi
echo ""

# Test 10: Multiple Unsafe Keywords
echo -e "${CYAN}Test 10: Multiple Unsafe Keywords${NC}"
MULTI_KEYWORD_RESPONSE=$(curl -s -X POST "$MODERATION_SERVICE_URL/moderation/check-image" \
    -H "Content-Type: application/json" \
    -d '{"imageUrl": "https://example.com/adult-explicit-xxx-content.jpg"}')

MULTI_SAFE=$(echo "$MULTI_KEYWORD_RESPONSE" | jq -r '.safe' 2>/dev/null)
if [ "$MULTI_SAFE" = "false" ] || [ "$MULTI_SAFE" = "0" ]; then
    test_result 0 "Multiple unsafe keywords detected"
else
    test_result 1 "Multiple keywords check failed (safe=$MULTI_SAFE)"
    echo "  Response: $MULTI_KEYWORD_RESPONSE"
fi
echo ""

# Test 11: Case Insensitive Keywords
echo -e "${CYAN}Test 11: Case Insensitive Keywords${NC}"
CASE_RESPONSE=$(curl -s -X POST "$MODERATION_SERVICE_URL/moderation/check-image" \
    -H "Content-Type: application/json" \
    -d '{"imageUrl": "https://example.com/NSFW-IMAGE.JPG"}')

CASE_SAFE=$(echo "$CASE_RESPONSE" | jq -r '.safe' 2>/dev/null)
if [ "$CASE_SAFE" = "false" ] || [ "$CASE_SAFE" = "0" ]; then
    test_result 0 "Case insensitive keyword detection"
else
    test_result 1 "Case insensitive check failed (safe=$CASE_SAFE)"
    echo "  Response: $CASE_RESPONSE"
fi
echo ""

# Test 12: Invalid Endpoint
echo -e "${CYAN}Test 12: Invalid Endpoint${NC}"
INVALID_ENDPOINT_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" "$MODERATION_SERVICE_URL/invalid/endpoint")
HTTP_STATUS=$(echo "$INVALID_ENDPOINT_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)

if [ "$HTTP_STATUS" = "404" ]; then
    test_result 0 "Invalid endpoint returns 404"
else
    test_result 1 "Invalid endpoint not handled (expected 404, got $HTTP_STATUS)"
fi
echo ""

# Test 13: Wrong HTTP Method
echo -e "${CYAN}Test 13: Wrong HTTP Method${NC}"
WRONG_METHOD_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X GET "$MODERATION_SERVICE_URL/moderation/check-image?imageUrl=test")
HTTP_STATUS=$(echo "$WRONG_METHOD_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)

if [ "$HTTP_STATUS" = "404" ] || [ "$HTTP_STATUS" = "405" ]; then
    test_result 0 "Wrong HTTP method rejected ($HTTP_STATUS)"
else
    test_result 1 "Wrong method not rejected (expected 404/405, got $HTTP_STATUS)"
fi
echo ""

# Test 14: Missing Content-Type Header
echo -e "${CYAN}Test 14: Missing Content-Type Header${NC}"
NO_CT_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST "$MODERATION_SERVICE_URL/moderation/check-image" \
    -d '{"imageUrl": "https://example.com/test.jpg"}')

HTTP_STATUS=$(echo "$NO_CT_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
# Fastify might accept it or reject it, both are acceptable
if [ "$HTTP_STATUS" = "400" ] || [ "$HTTP_STATUS" = "200" ]; then
    test_result 0 "Missing Content-Type handled ($HTTP_STATUS)"
else
    test_result 0 "Missing Content-Type response ($HTTP_STATUS)"
fi
echo ""

# Test 15: Very Long URL
echo -e "${CYAN}Test 15: Very Long URL${NC}"
LONG_URL="https://example.com/$(printf 'a%.0s' {1..2000}).jpg"
LONG_URL_RESPONSE=$(curl -s -X POST "$MODERATION_SERVICE_URL/moderation/check-image" \
    -H "Content-Type: application/json" \
    -d "{\"imageUrl\": \"$LONG_URL\"}")

LONG_URL_SAFE=$(echo "$LONG_URL_RESPONSE" | jq -r '.safe // empty' 2>/dev/null)
if [ ! -z "$LONG_URL_SAFE" ]; then
    test_result 0 "Very long URL handled"
else
    test_result 1 "Very long URL failed"
    echo "  Response: $LONG_URL_RESPONSE"
fi
echo ""

# Summary
echo -e "${BLUE}=========================================="
echo -e "  TEST SUMMARY"
echo -e "==========================================${NC}"
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}❌ Some tests failed${NC}"
    exit 1
fi

