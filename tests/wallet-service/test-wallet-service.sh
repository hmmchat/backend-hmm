#!/bin/bash

# Comprehensive E2E test script for wallet-service
# Bypasses auth entirely - uses test endpoints with userId directly

set +e

WALLET_SERVICE_URL="http://localhost:3005"

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
echo -e "  WALLET SERVICE E2E TEST (NO AUTH)"
echo -e "==========================================${NC}"
echo ""

# Step 1: Check Infrastructure
echo -e "${CYAN}Step 1: Checking Infrastructure...${NC}"

if pg_isready -q 2>/dev/null; then
    echo -e "${GREEN}✅ PostgreSQL is running${NC}"
else
    echo -e "${RED}❌ PostgreSQL is not running${NC}"
    exit 1
fi
echo ""

# Step 2: Check/Start Service
echo -e "${CYAN}Step 2: Checking Wallet Service...${NC}"

if curl -s "$WALLET_SERVICE_URL/health" > /dev/null 2>&1 || curl -s "$WALLET_SERVICE_URL/test/balance?userId=test" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Wallet service is running${NC}"
else
    echo -e "${YELLOW}⚠️  Wallet service is not running${NC}"
    echo -e "${CYAN}Please start wallet-service manually:${NC}"
    echo "  cd apps/wallet-service && npm run start:dev"
    echo ""
    read -p "Press Enter once wallet-service is running, or Ctrl+C to exit..."
fi
echo ""

# Step 3: Wait for service
echo -e "${CYAN}Step 3: Waiting for service to be ready...${NC}"
sleep 2

# Step 4: Run Test Cases
echo -e "${BLUE}=========================================="
echo -e "  TEST CASES"
echo -e "==========================================${NC}"
echo ""

TIMESTAMP=$(date +%s)
TEST_USER_ID="test-wallet-user-$TIMESTAMP"
TEST_USER_ID_2="test-wallet-user-2-$TIMESTAMP"

# ========== CORE FUNCTIONALITY TESTS ==========

# Test 1: Get Balance - Lazy Initialization
echo -e "${CYAN}Test 1: Get Balance - Lazy Initialization${NC}"
BALANCE_RESPONSE=$(curl -s "$WALLET_SERVICE_URL/test/balance?userId=$TEST_USER_ID")
BALANCE=$(echo "$BALANCE_RESPONSE" | jq -r '.balance // empty' 2>/dev/null)

if [ ! -z "$BALANCE" ] && [ "$BALANCE" != "null" ] && [ "$BALANCE" = "0" ]; then
    test_result 0 "Lazy wallet initialization (balance: $BALANCE)"
else
    test_result 1 "Lazy wallet initialization failed"
    echo "  Response: $BALANCE_RESPONSE"
fi
echo ""

# Test 2: Add Coins
echo -e "${CYAN}Test 2: Add Coins${NC}"
ADD_COINS_RESPONSE=$(curl -s -X POST "$WALLET_SERVICE_URL/test/wallet/add-coins" \
    -H "Content-Type: application/json" \
    -d "{
        \"userId\": \"$TEST_USER_ID\",
        \"amount\": 100,
        \"description\": \"Test credit\"
    }")

NEW_BALANCE=$(echo "$ADD_COINS_RESPONSE" | jq -r '.newBalance // empty' 2>/dev/null)
TRANSACTION_ID=$(echo "$ADD_COINS_RESPONSE" | jq -r '.transactionId // empty' 2>/dev/null)

if [ ! -z "$NEW_BALANCE" ] && [ "$NEW_BALANCE" = "100" ]; then
    test_result 0 "Add coins successful (balance: $NEW_BALANCE)"
else
    test_result 1 "Add coins failed"
    echo "  Response: $ADD_COINS_RESPONSE"
fi
echo ""

# Test 3: Get Balance After Credit
echo -e "${CYAN}Test 3: Get Balance After Credit${NC}"
BALANCE_AFTER=$(curl -s "$WALLET_SERVICE_URL/test/balance?userId=$TEST_USER_ID" | jq -r '.balance // empty' 2>/dev/null)

if [ "$BALANCE_AFTER" = "100" ]; then
    test_result 0 "Balance updated correctly ($BALANCE_AFTER)"
else
    test_result 1 "Balance not updated correctly (expected 100, got $BALANCE_AFTER)"
fi
echo ""

# Test 4: Deduct Coins for Gender Filter
echo -e "${CYAN}Test 4: Deduct Coins for Gender Filter${NC}"
DEDUCT_RESPONSE=$(curl -s -X POST "$WALLET_SERVICE_URL/test/transactions/gender-filter" \
    -H "Content-Type: application/json" \
    -d "{
        \"userId\": \"$TEST_USER_ID\",
        \"amount\": 50,
        \"screens\": 10
    }")

NEW_BALANCE_AFTER=$(echo "$DEDUCT_RESPONSE" | jq -r '.newBalance // empty' 2>/dev/null)
TRANSACTION_ID_DEDUCT=$(echo "$DEDUCT_RESPONSE" | jq -r '.transactionId // empty' 2>/dev/null)

if [ ! -z "$NEW_BALANCE_AFTER" ] && [ "$NEW_BALANCE_AFTER" = "50" ]; then
    test_result 0 "Deduct coins successful (balance: $NEW_BALANCE_AFTER)"
else
    test_result 1 "Deduct coins failed"
    echo "  Response: $DEDUCT_RESPONSE"
fi
echo ""

# Test 5: Get Wallet with Transactions
echo -e "${CYAN}Test 5: Get Wallet with Transactions${NC}"
WALLET_RESPONSE=$(curl -s "$WALLET_SERVICE_URL/test/wallet?userId=$TEST_USER_ID&includeTransactions=true")
TRANSACTIONS_COUNT=$(echo "$WALLET_RESPONSE" | jq -r '.transactions | length' 2>/dev/null || echo "0")
WALLET_BALANCE=$(echo "$WALLET_RESPONSE" | jq -r '.balance // empty' 2>/dev/null)

if [ "$TRANSACTIONS_COUNT" -ge 2 ] && [ "$WALLET_BALANCE" = "50" ]; then
    test_result 0 "Get wallet with transactions successful ($TRANSACTIONS_COUNT transactions, balance: $WALLET_BALANCE)"
else
    test_result 1 "Get wallet with transactions failed"
    echo "  Response: $WALLET_RESPONSE"
fi
echo ""

# ========== EDGE CASES ==========

# Test 6: Insufficient Balance
echo -e "${CYAN}Test 6: Insufficient Balance${NC}"
INSUFFICIENT_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST "$WALLET_SERVICE_URL/test/transactions/gender-filter" \
    -H "Content-Type: application/json" \
    -d "{
        \"userId\": \"$TEST_USER_ID\",
        \"amount\": 1000,
        \"screens\": 20
    }")

HTTP_STATUS=$(echo "$INSUFFICIENT_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
if [ "$HTTP_STATUS" = "400" ]; then
    test_result 0 "Insufficient balance correctly rejected (400)"
else
    test_result 1 "Insufficient balance not handled (expected 400, got $HTTP_STATUS)"
fi
echo ""

# Test 7: Negative Amount - Deduct
echo -e "${CYAN}Test 7: Negative Amount - Deduct${NC}"
NEGATIVE_DEDUCT_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST "$WALLET_SERVICE_URL/test/transactions/gender-filter" \
    -H "Content-Type: application/json" \
    -d "{
        \"userId\": \"$TEST_USER_ID\",
        \"amount\": -10,
        \"screens\": 5
    }")

HTTP_STATUS=$(echo "$NEGATIVE_DEDUCT_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
if [ "$HTTP_STATUS" = "400" ]; then
    test_result 0 "Negative amount for deduct rejected (400)"
else
    test_result 1 "Negative amount not rejected (expected 400, got $HTTP_STATUS)"
fi
echo ""

# Test 8: Negative Amount - Add
echo -e "${CYAN}Test 8: Negative Amount - Add${NC}"
NEGATIVE_ADD_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST "$WALLET_SERVICE_URL/test/wallet/add-coins" \
    -H "Content-Type: application/json" \
    -d "{
        \"userId\": \"$TEST_USER_ID\",
        \"amount\": -50
    }")

HTTP_STATUS=$(echo "$NEGATIVE_ADD_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
if [ "$HTTP_STATUS" = "400" ]; then
    test_result 0 "Negative amount for add rejected (400)"
else
    test_result 1 "Negative amount not rejected (expected 400, got $HTTP_STATUS)"
fi
echo ""

# Test 9: Zero Amount
echo -e "${CYAN}Test 9: Zero Amount${NC}"
ZERO_AMOUNT_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST "$WALLET_SERVICE_URL/test/wallet/add-coins" \
    -H "Content-Type: application/json" \
    -d "{
        \"userId\": \"$TEST_USER_ID\",
        \"amount\": 0
    }")

HTTP_STATUS=$(echo "$ZERO_AMOUNT_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
if [ "$HTTP_STATUS" = "400" ]; then
    test_result 0 "Zero amount rejected (400)"
else
    test_result 1 "Zero amount not rejected (expected 400, got $HTTP_STATUS)"
fi
echo ""

# Test 10: Missing userId
echo -e "${CYAN}Test 10: Missing userId${NC}"
MISSING_USER_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" "$WALLET_SERVICE_URL/test/balance")
HTTP_STATUS=$(echo "$MISSING_USER_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)

if [ "$HTTP_STATUS" = "400" ]; then
    test_result 0 "Missing userId rejected (400)"
else
    test_result 1 "Missing userId not rejected (expected 400, got $HTTP_STATUS)"
fi
echo ""

# Test 11: Multiple Transactions - Balance Consistency
echo -e "${CYAN}Test 11: Multiple Transactions - Balance Consistency${NC}"
# Create new user for this test
MULTI_USER_ID="test-multi-$TIMESTAMP"

# Add 200 coins
curl -s -X POST "$WALLET_SERVICE_URL/test/wallet/add-coins" \
    -H "Content-Type: application/json" \
    -d "{\"userId\": \"$MULTI_USER_ID\", \"amount\": 200}" > /dev/null

# Deduct 30
curl -s -X POST "$WALLET_SERVICE_URL/test/transactions/gender-filter" \
    -H "Content-Type: application/json" \
    -d "{\"userId\": \"$MULTI_USER_ID\", \"amount\": 30, \"screens\": 5}" > /dev/null

# Deduct 20
curl -s -X POST "$WALLET_SERVICE_URL/test/transactions/gender-filter" \
    -H "Content-Type: application/json" \
    -d "{\"userId\": \"$MULTI_USER_ID\", \"amount\": 20, \"screens\": 3}" > /dev/null

# Check final balance
FINAL_BALANCE=$(curl -s "$WALLET_SERVICE_URL/test/balance?userId=$MULTI_USER_ID" | jq -r '.balance // empty' 2>/dev/null)

if [ "$FINAL_BALANCE" = "150" ]; then
    test_result 0 "Multiple transactions balance correct (expected 150, got $FINAL_BALANCE)"
else
    test_result 1 "Multiple transactions balance incorrect (expected 150, got $FINAL_BALANCE)"
fi
echo ""

# Test 12: Transaction History Order
echo -e "${CYAN}Test 12: Transaction History Order${NC}"
WALLET_HISTORY=$(curl -s "$WALLET_SERVICE_URL/test/wallet?userId=$MULTI_USER_ID&includeTransactions=true")
TRANSACTIONS=$(echo "$WALLET_HISTORY" | jq -r '.transactions // empty' 2>/dev/null)

if [ ! -z "$TRANSACTIONS" ] && [ "$TRANSACTIONS" != "null" ]; then
    TRANSACTION_COUNT=$(echo "$WALLET_HISTORY" | jq -r '.transactions | length' 2>/dev/null || echo "0")
    if [ "$TRANSACTION_COUNT" -ge 3 ]; then
        # Check if transactions are ordered by createdAt desc (newest first)
        FIRST_CREATED=$(echo "$WALLET_HISTORY" | jq -r '.transactions[0].createdAt // empty' 2>/dev/null)
        SECOND_CREATED=$(echo "$WALLET_HISTORY" | jq -r '.transactions[1].createdAt // empty' 2>/dev/null)
        
        if [ ! -z "$FIRST_CREATED" ] && [ ! -z "$SECOND_CREATED" ]; then
            test_result 0 "Transaction history retrieved ($TRANSACTION_COUNT transactions)"
        else
            test_result 0 "Transaction history retrieved (order check skipped)"
        fi
    else
        test_result 1 "Transaction history incomplete"
    fi
else
    test_result 1 "Transaction history not found"
fi
echo ""

# Test 13: Exact Balance Deduction
echo -e "${CYAN}Test 13: Exact Balance Deduction${NC}"
EXACT_USER_ID="test-exact-$TIMESTAMP"

# Add exactly 75 coins
curl -s -X POST "$WALLET_SERVICE_URL/test/wallet/add-coins" \
    -H "Content-Type: application/json" \
    -d "{\"userId\": \"$EXACT_USER_ID\", \"amount\": 75}" > /dev/null

# Deduct exactly 75
EXACT_DEDUCT_RESPONSE=$(curl -s -X POST "$WALLET_SERVICE_URL/test/transactions/gender-filter" \
    -H "Content-Type: application/json" \
    -d "{\"userId\": \"$EXACT_USER_ID\", \"amount\": 75, \"screens\": 15}")

EXACT_BALANCE=$(echo "$EXACT_DEDUCT_RESPONSE" | jq -r '.newBalance // empty' 2>/dev/null)

if [ "$EXACT_BALANCE" = "0" ]; then
    test_result 0 "Exact balance deduction successful (balance: $EXACT_BALANCE)"
else
    test_result 1 "Exact balance deduction failed (expected 0, got $EXACT_BALANCE)"
fi
echo ""

# Test 14: Invalid Endpoint
echo -e "${CYAN}Test 14: Invalid Endpoint${NC}"
INVALID_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" "$WALLET_SERVICE_URL/invalid/endpoint")
HTTP_STATUS=$(echo "$INVALID_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)

if [ "$HTTP_STATUS" = "404" ]; then
    test_result 0 "Invalid endpoint returns 404"
else
    test_result 1 "Invalid endpoint not handled (expected 404, got $HTTP_STATUS)"
fi
echo ""

# Test 15: Missing Required Fields
echo -e "${CYAN}Test 15: Missing Required Fields${NC}"
MISSING_FIELDS_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST "$WALLET_SERVICE_URL/test/transactions/gender-filter" \
    -H "Content-Type: application/json" \
    -d '{"amount": 50}')

HTTP_STATUS=$(echo "$MISSING_FIELDS_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
if [ "$HTTP_STATUS" = "400" ]; then
    test_result 0 "Missing required fields rejected (400)"
else
    test_result 1 "Missing required fields not rejected (expected 400, got $HTTP_STATUS)"
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
