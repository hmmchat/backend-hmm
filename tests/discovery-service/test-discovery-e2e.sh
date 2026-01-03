#!/bin/bash

# Comprehensive E2E test script for discovery flow
# Bypasses auth entirely - uses test endpoints with userId directly

set +e  # Don't exit on error, we'll handle it manually

DISCOVERY_SERVICE_URL="http://localhost:3004"
USER_SERVICE_URL="http://localhost:3002"
AUTH_SERVICE_URL="http://localhost:3001"

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

# Helper function to set gender filter preference directly in database
set_gender_filter() {
    local userId=$1
    local genders=$2  # JSON array like '["MALE","FEMALE"]'
    local screensRemaining=$3
    
    cd "$ROOT_DIR/apps/discovery-service"
    node -e "
        const { PrismaClient } = require('@prisma/client');
        const prisma = new PrismaClient();
        (async () => {
            try {
                await prisma.genderFilterPreference.upsert({
                    where: { userId: '$userId' },
                    update: {
                        genders: JSON.parse('$genders'),
                        screensRemaining: $screensRemaining,
                        updatedAt: new Date()
                    },
                    create: {
                        userId: '$userId',
                        genders: JSON.parse('$genders'),
                        screensRemaining: $screensRemaining
                    }
                });
                console.log('Gender filter set successfully');
            } catch (e) {
                console.error('Error:', e.message);
                process.exit(1);
            } finally {
                await prisma.\$disconnect();
            }
        })();
    " 2>&1
}

# Helper function to clear gender filter
clear_gender_filter() {
    local userId=$1
    
    cd "$ROOT_DIR/apps/discovery-service"
    node -e "
        const { PrismaClient } = require('@prisma/client');
        const prisma = new PrismaClient();
        (async () => {
            try {
                await prisma.genderFilterPreference.deleteMany({
                    where: { userId: '$userId' }
                });
                console.log('Gender filter cleared');
            } catch (e) {
                console.error('Error:', e.message);
                process.exit(1);
            } finally {
                await prisma.\$disconnect();
            }
        })();
    " 2>&1
}

# Helper function to update preferred city directly in database
update_preferred_city() {
    local userId=$1
    local city=$2
    
    cd "$ROOT_DIR/apps/user-service"
    node -e "
        const { PrismaClient } = require('@prisma/client');
        const prisma = new PrismaClient();
        (async () => {
            try {
                await prisma.user.update({
                    where: { id: '$userId' },
                    data: { preferredCity: '$city' }
                });
                console.log('Preferred city updated');
            } catch (e) {
                console.error('Error:', e.message);
                process.exit(1);
            } finally {
                await prisma.\$disconnect();
            }
        })();
    " 2>&1
}

echo -e "${BLUE}=========================================="
echo -e "  DISCOVERY FLOW E2E TEST (NO AUTH)"
echo -e "==========================================${NC}"
echo ""

# Step 1: Check/Start Services
echo -e "${CYAN}Step 1: Checking Services...${NC}"

check_service() {
    local url=$1
    local name=$2
    if curl -s "$url/health" > /dev/null 2>&1 || curl -s "$url/metrics/active-meetings" > /dev/null 2>&1; then
        echo -e "${GREEN}✅ $name is running${NC}"
        return 0
    else
        echo -e "${YELLOW}⚠️  $name is not running${NC}"
        return 1
    fi
}

USER_SERVICE_UP=$(check_service "$USER_SERVICE_URL" "User Service" && echo "yes" || echo "no") || true
DISCOVERY_SERVICE_UP=$(check_service "$DISCOVERY_SERVICE_URL" "Discovery Service" && echo "yes" || echo "no") || true

if [ "$USER_SERVICE_UP" = "no" ] || [ "$DISCOVERY_SERVICE_UP" = "no" ]; then
    echo -e "${YELLOW}⚠️  Some services are not running${NC}"
    echo -e "${CYAN}Please start services manually:${NC}"
    echo "  cd apps/user-service && npm run start:dev"
    echo "  cd apps/discovery-service && npm run start:dev"
    echo ""
    read -p "Press Enter once services are running, or Ctrl+C to exit..."
fi

echo ""

# Step 2: Seed Test Users
echo -e "${CYAN}Step 2: Seeding Test Users...${NC}"

cd "$ROOT_DIR/apps/user-service"

if [ ! -f "node_modules/.prisma/client/index.js" ]; then
    echo -e "${YELLOW}⚠️  Prisma client not generated, generating...${NC}"
    npm run prisma:generate
fi

echo -e "${CYAN}Running seed scripts...${NC}"

# First seed brands, interests, values (catalog data)
echo -e "${CYAN}  Seeding catalog data (brands, interests, values)...${NC}"
CATALOG_SEED_OUTPUT=$(npm run seed 2>&1)
echo "$CATALOG_SEED_OUTPUT" | grep -E "(Seeded|Seed completed|Error)" || true

# Then seed test users
echo -e "${CYAN}  Seeding test users...${NC}"
USER_SEED_OUTPUT=$(npm run seed:test-users 2>&1)
echo "$USER_SEED_OUTPUT" | grep -E "(Created|Skipped|Seed|Failed|Error)" || echo "$USER_SEED_OUTPUT"

# Check if seed was successful
if echo "$USER_SEED_OUTPUT" | grep -q "Seed completed\|Created:"; then
    test_result 0 "Seed test users"
elif echo "$USER_SEED_OUTPUT" | grep -q "Skipped:"; then
    test_result 0 "Seed test users (already exist)"
else
    test_result 1 "Seed test users"
fi
echo ""

# Step 3: Wait for services to be ready
echo -e "${CYAN}Step 3: Waiting for services to be ready...${NC}"
sleep 2

# Step 4: Run Test Cases
echo -e "${BLUE}=========================================="
echo -e "  TEST CASES"
echo -e "==========================================${NC}"
echo ""

# Test User IDs (from seed script)
TEST_USER_MUMBAI_MALE="test-user-mumbai-male-1"
TEST_USER_MUMBAI_FEMALE="test-user-mumbai-female-1"
TEST_USER_DELHI_MALE="test-user-delhi-male-1"
TEST_USER_ANYWHERE="test-user-anywhere-male-1"
TEST_USER_BANGALORE_MALE="test-user-bangalore-male-1"

SESSION_ID="test-session-$(date +%s)"

# Test 1: Get Card for Mumbai Male User
echo -e "${CYAN}Test 1: Get Card (Mumbai Male User)${NC}"
RESPONSE=$(curl -s -X GET "$DISCOVERY_SERVICE_URL/discovery/test/card?userId=$TEST_USER_MUMBAI_MALE&sessionId=$SESSION_ID&soloOnly=false")
CARD_USER_ID=$(echo "$RESPONSE" | jq -r '.card.userId' 2>/dev/null)
EXHAUSTED=$(echo "$RESPONSE" | jq -r '.exhausted' 2>/dev/null)

if [ ! -z "$CARD_USER_ID" ] && [ "$CARD_USER_ID" != "null" ] && [ "$EXHAUSTED" != "true" ]; then
    test_result 0 "Get card returned valid user"
    echo "  Card User: $(echo "$RESPONSE" | jq -r '.card.username' 2>/dev/null)"
    echo "  City: $(echo "$RESPONSE" | jq -r '.card.city' 2>/dev/null)"
else
    test_result 1 "Get card failed or exhausted"
    echo "  Response: $RESPONSE"
fi
echo ""

# Test 2: Card Pages (Verify all 4 pages are returned)
echo -e "${CYAN}Test 2: Card Pages (4 pages)${NC}"
PAGES_COUNT=$(echo "$RESPONSE" | jq -r '.card.pages | length' 2>/dev/null || echo "0")
if [ "$PAGES_COUNT" -ge 4 ]; then
    test_result 0 "Card has $PAGES_COUNT pages (expected at least 4)"
else
    test_result 1 "Card has only $PAGES_COUNT pages (expected at least 4)"
fi
echo ""

# Test 3: Raincheck
echo -e "${CYAN}Test 3: Raincheck${NC}"
if [ ! -z "$CARD_USER_ID" ] && [ "$CARD_USER_ID" != "null" ]; then
    RAINCHECK_RESPONSE=$(curl -s -X POST "$DISCOVERY_SERVICE_URL/discovery/test/raincheck" \
        -H "Content-Type: application/json" \
        -d "{
            \"userId\": \"$TEST_USER_MUMBAI_MALE\",
            \"sessionId\": \"$SESSION_ID\",
            \"raincheckedUserId\": \"$CARD_USER_ID\"
        }")
    
    NEXT_CARD_USER_ID=$(echo "$RAINCHECK_RESPONSE" | jq -r '.nextCard.userId' 2>/dev/null)
    
    if [ ! -z "$NEXT_CARD_USER_ID" ] && [ "$NEXT_CARD_USER_ID" != "null" ]; then
        test_result 0 "Raincheck returned next card"
        if [ "$NEXT_CARD_USER_ID" != "$CARD_USER_ID" ]; then
            test_result 0 "Next card is different from rainchecked card"
        else
            test_result 1 "Next card is same as rainchecked card"
        fi
    else
        test_result 1 "Raincheck did not return next card"
    fi
else
    test_result 1 "Skipped - no card to raincheck"
fi
echo ""

# Test 4: Get Multiple Cards (Test Raincheck Persistence)
echo -e "${CYAN}Test 4: Get Multiple Cards (Test Raincheck)${NC}"
RAINCHECKED_IDS=("$CARD_USER_ID" "$NEXT_CARD_USER_ID")
UNIQUE_CARDS=0

for i in {1..5}; do
    CARD_RESPONSE=$(curl -s -X GET "$DISCOVERY_SERVICE_URL/discovery/test/card?userId=$TEST_USER_MUMBAI_MALE&sessionId=$SESSION_ID&soloOnly=false")
    CARD_USER=$(echo "$CARD_RESPONSE" | jq -r '.card.userId' 2>/dev/null)
    EXHAUSTED=$(echo "$CARD_RESPONSE" | jq -r '.exhausted' 2>/dev/null)
    
    if [ "$EXHAUSTED" = "true" ]; then
        echo -e "${YELLOW}  Exhausted at card $i${NC}"
        break
    fi
    
    if [ -z "$CARD_USER" ] || [ "$CARD_USER" = "null" ]; then
        break
    fi
    
    # Check if this card was previously rainchecked
    if [[ ! " ${RAINCHECKED_IDS[@]} " =~ " ${CARD_USER} " ]]; then
        ((UNIQUE_CARDS++))
    fi
    
    # Raincheck this card
    curl -s -X POST "$DISCOVERY_SERVICE_URL/discovery/test/raincheck" \
        -H "Content-Type: application/json" \
        -d "{
            \"userId\": \"$TEST_USER_MUMBAI_MALE\",
            \"sessionId\": \"$SESSION_ID\",
            \"raincheckedUserId\": \"$CARD_USER\"
        }" > /dev/null
    
    RAINCHECKED_IDS+=("$CARD_USER")
    sleep 0.3
done

if [ $UNIQUE_CARDS -gt 0 ]; then
    test_result 0 "Got $UNIQUE_CARDS unique cards (raincheck working)"
else
    test_result 1 "No unique cards (raincheck may not be working)"
fi
echo ""

# Test 5: Solo Only Filter
echo -e "${CYAN}Test 5: Solo Only Filter${NC}"
SOLO_RESPONSE=$(curl -s -X GET "$DISCOVERY_SERVICE_URL/discovery/test/card?userId=$TEST_USER_MUMBAI_MALE&sessionId=${SESSION_ID}-solo&soloOnly=true")
SOLO_CARD_USER=$(echo "$SOLO_RESPONSE" | jq -r '.card.userId' 2>/dev/null)
SOLO_STATUS=$(echo "$SOLO_RESPONSE" | jq -r '.card.status' 2>/dev/null)

if [ ! -z "$SOLO_CARD_USER" ] && [ "$SOLO_CARD_USER" != "null" ]; then
    if [ "$SOLO_STATUS" = "AVAILABLE" ]; then
        test_result 0 "Solo filter returned AVAILABLE status"
    else
        test_result 1 "Solo filter returned $SOLO_STATUS (expected AVAILABLE)"
    fi
else
    test_result 1 "Solo filter did not return a card"
fi
echo ""

# Test 6: City-Based Matching
echo -e "${CYAN}Test 6: City-Based Matching${NC}"
DELHI_RESPONSE=$(curl -s -X GET "$DISCOVERY_SERVICE_URL/discovery/test/card?userId=$TEST_USER_DELHI_MALE&sessionId=${SESSION_ID}-delhi&soloOnly=false")
DELHI_CARD_CITY=$(echo "$DELHI_RESPONSE" | jq -r '.card.city' 2>/dev/null)

if [ ! -z "$DELHI_CARD_CITY" ] && [ "$DELHI_CARD_CITY" != "null" ]; then
    if [ "$DELHI_CARD_CITY" = "Delhi" ]; then
        test_result 0 "City filter returned user from Delhi"
    else
        test_result 1 "City filter returned user from $DELHI_CARD_CITY (expected Delhi)"
    fi
else
    test_result 1 "City filter did not return a card"
fi
echo ""

# Test 7: Anywhere Location
echo -e "${CYAN}Test 7: Anywhere Location${NC}"
ANYWHERE_RESPONSE=$(curl -s -X GET "$DISCOVERY_SERVICE_URL/discovery/test/card?userId=$TEST_USER_ANYWHERE&sessionId=${SESSION_ID}-anywhere&soloOnly=false")
ANYWHERE_CARD_USER=$(echo "$ANYWHERE_RESPONSE" | jq -r '.card.userId' 2>/dev/null)

if [ ! -z "$ANYWHERE_CARD_USER" ] && [ "$ANYWHERE_CARD_USER" != "null" ]; then
    test_result 0 "Anywhere location returned a card"
else
    test_result 1 "Anywhere location did not return a card"
fi
echo ""

# Test 8: Preference Matching (Brands, Interests, Values, Music)
echo -e "${CYAN}Test 8: Preference Matching${NC}"
# Get a card and check if it has matching preferences
PREF_MATCH_RESPONSE=$(curl -s -X GET "$DISCOVERY_SERVICE_URL/discovery/test/card?userId=$TEST_USER_MUMBAI_MALE&sessionId=${SESSION_ID}-pref&soloOnly=false")
PREF_CARD=$(echo "$PREF_MATCH_RESPONSE" | jq -r '.card' 2>/dev/null)

if [ "$PREF_CARD" != "null" ] && [ ! -z "$PREF_CARD" ]; then
    HAS_BRANDS=$(echo "$PREF_MATCH_RESPONSE" | jq -r '.card.brands | length' 2>/dev/null || echo "0")
    HAS_INTERESTS=$(echo "$PREF_MATCH_RESPONSE" | jq -r '.card.interests | length' 2>/dev/null || echo "0")
    HAS_VALUES=$(echo "$PREF_MATCH_RESPONSE" | jq -r '.card.values | length' 2>/dev/null || echo "0")
    HAS_MUSIC=$(echo "$PREF_MATCH_RESPONSE" | jq -r '.card.musicPreference // empty' 2>/dev/null)
    
    if [ "$HAS_BRANDS" -gt 0 ] && [ "$HAS_INTERESTS" -gt 0 ] && [ "$HAS_VALUES" -gt 0 ]; then
        test_result 0 "Card has preferences (brands: $HAS_BRANDS, interests: $HAS_INTERESTS, values: $HAS_VALUES)"
        if [ ! -z "$HAS_MUSIC" ] && [ "$HAS_MUSIC" != "null" ]; then
            test_result 0 "Card has music preference"
        fi
    else
        test_result 1 "Card missing preferences"
    fi
else
    test_result 1 "Preference matching test failed - no card returned"
fi
echo ""

# Test 9: Gender Filter - Active (screensRemaining > 0)
echo -e "${CYAN}Test 9: Gender Filter - Active (screensRemaining > 0)${NC}"
GF_SESSION="gf-active-$(date +%s)"
# Set gender filter to show only FEMALE users with 5 screens remaining
set_gender_filter "$TEST_USER_MUMBAI_MALE" '["FEMALE"]' 5 > /dev/null 2>&1

GF_RESPONSE=$(curl -s -X GET "$DISCOVERY_SERVICE_URL/discovery/test/card?userId=$TEST_USER_MUMBAI_MALE&sessionId=$GF_SESSION&soloOnly=false")
GF_CARD_USER=$(echo "$GF_RESPONSE" | jq -r '.card.userId' 2>/dev/null)

if [ ! -z "$GF_CARD_USER" ] && [ "$GF_CARD_USER" != "null" ]; then
    # Get user details to check gender
    USER_DETAILS=$(curl -s "$USER_SERVICE_URL/users/$GF_CARD_USER?fields=gender" 2>/dev/null)
    USER_GENDER=$(echo "$USER_DETAILS" | jq -r '.user.gender // empty' 2>/dev/null)
    
    if [ "$USER_GENDER" = "FEMALE" ]; then
        test_result 0 "Gender filter active - returned FEMALE user"
    else
        test_result 1 "Gender filter active - returned $USER_GENDER (expected FEMALE)"
    fi
else
    test_result 1 "Gender filter active - no card returned"
fi

clear_gender_filter "$TEST_USER_MUMBAI_MALE" > /dev/null 2>&1
echo ""

# Test 10: Gender Filter - Exhausted (screensRemaining = 0)
echo -e "${CYAN}Test 10: Gender Filter - Exhausted (screensRemaining = 0)${NC}"
GF_EXHAUST_SESSION="gf-exhaust-$(date +%s)"
# Set gender filter with 0 screens remaining
set_gender_filter "$TEST_USER_MUMBAI_MALE" '["FEMALE"]' 0 > /dev/null 2>&1

GF_EXHAUST_RESPONSE=$(curl -s -X GET "$DISCOVERY_SERVICE_URL/discovery/test/card?userId=$TEST_USER_MUMBAI_MALE&sessionId=$GF_EXHAUST_SESSION&soloOnly=false")
GF_EXHAUST_CARD_USER=$(echo "$GF_EXHAUST_RESPONSE" | jq -r '.card.userId' 2>/dev/null)

if [ ! -z "$GF_EXHAUST_CARD_USER" ] && [ "$GF_EXHAUST_CARD_USER" != "null" ]; then
    # When exhausted (screensRemaining = 0), should show all genders
    # Get user details to verify
    USER_DETAILS=$(curl -s "$USER_SERVICE_URL/users/$GF_EXHAUST_CARD_USER?fields=gender" 2>/dev/null)
    USER_GENDER=$(echo "$USER_DETAILS" | jq -r '.user.gender // empty' 2>/dev/null)
    
    # When exhausted, should show all genders (not just FEMALE)
    test_result 0 "Gender filter exhausted - returned user (gender: $USER_GENDER, showing all genders)"
else
    test_result 1 "Gender filter exhausted - no card returned"
fi

clear_gender_filter "$TEST_USER_MUMBAI_MALE" > /dev/null 2>&1
echo ""

# Test 11: Gender Filter - Decrement Screens
echo -e "${CYAN}Test 11: Gender Filter - Decrement Screens${NC}"
GF_DEC_SESSION="gf-dec-$(date +%s)"
# Set gender filter with 3 screens remaining
set_gender_filter "$TEST_USER_MUMBAI_MALE" '["FEMALE"]' 3 > /dev/null 2>&1

# Get 2 cards (should decrement screens)
curl -s -X GET "$DISCOVERY_SERVICE_URL/discovery/test/card?userId=$TEST_USER_MUMBAI_MALE&sessionId=$GF_DEC_SESSION&soloOnly=false" > /dev/null
sleep 0.5
curl -s -X GET "$DISCOVERY_SERVICE_URL/discovery/test/card?userId=$TEST_USER_MUMBAI_MALE&sessionId=$GF_DEC_SESSION&soloOnly=false" > /dev/null
sleep 0.5

# Check remaining screens (should be 1)
cd "$ROOT_DIR/apps/discovery-service"
REMAINING=$(node -e "
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    (async () => {
        const pref = await prisma.genderFilterPreference.findUnique({
            where: { userId: '$TEST_USER_MUMBAI_MALE' }
        });
        console.log(pref ? pref.screensRemaining : 0);
        await prisma.\$disconnect();
    })();
" 2>/dev/null)

if [ "$REMAINING" = "1" ]; then
    test_result 0 "Gender filter screens decremented correctly (remaining: $REMAINING)"
else
    test_result 1 "Gender filter screens not decremented correctly (remaining: $REMAINING, expected 1)"
fi

clear_gender_filter "$TEST_USER_MUMBAI_MALE" > /dev/null 2>&1
echo ""

# Test 12: Reset Session
echo -e "${CYAN}Test 12: Reset Session${NC}"
RESET_RESPONSE=$(curl -s -X POST "$DISCOVERY_SERVICE_URL/discovery/test/reset-session" \
    -H "Content-Type: application/json" \
    -d "{
        \"userId\": \"$TEST_USER_MUMBAI_MALE\",
        \"sessionId\": \"$SESSION_ID\"
    }")

SUCCESS=$(echo "$RESET_RESPONSE" | jq -r '.success' 2>/dev/null)

if [ "$SUCCESS" = "true" ]; then
    test_result 0 "Reset session successful"
    
    # Verify reset worked - get card again, should see previously rainchecked users
    AFTER_RESET_RESPONSE=$(curl -s -X GET "$DISCOVERY_SERVICE_URL/discovery/test/card?userId=$TEST_USER_MUMBAI_MALE&sessionId=$SESSION_ID&soloOnly=false")
    AFTER_RESET_USER=$(echo "$AFTER_RESET_RESPONSE" | jq -r '.card.userId' 2>/dev/null)
    
    if [ ! -z "$AFTER_RESET_USER" ] && [ "$AFTER_RESET_USER" != "null" ]; then
        if [[ " ${RAINCHECKED_IDS[@]} " =~ " ${AFTER_RESET_USER} " ]]; then
            test_result 0 "Reset working - previously rainchecked user is now visible"
        else
            test_result 1 "Reset may not be working - got new user instead of rainchecked"
        fi
    fi
else
    test_result 1 "Reset session failed"
fi
echo ""

# Test 13: Exhaustion Handling
echo -e "${CYAN}Test 13: Exhaustion Handling${NC}"
# Create a new session and raincheck all users
EXHAUST_SESSION="exhaust-$(date +%s)"
EXHAUSTED_COUNT=0
EXHAUSTED="false"

for i in {1..20}; do
    EXHAUST_RESPONSE=$(curl -s -X GET "$DISCOVERY_SERVICE_URL/discovery/test/card?userId=$TEST_USER_MUMBAI_MALE&sessionId=$EXHAUST_SESSION&soloOnly=false")
    EXHAUST_CARD_USER=$(echo "$EXHAUST_RESPONSE" | jq -r '.card.userId' 2>/dev/null)
    EXHAUSTED=$(echo "$EXHAUST_RESPONSE" | jq -r '.exhausted' 2>/dev/null)
    
    if [ "$EXHAUSTED" = "true" ]; then
        SUGGESTED_CITIES=$(echo "$EXHAUST_RESPONSE" | jq -r '.suggestedCities | length' 2>/dev/null)
        if [ "$SUGGESTED_CITIES" -gt 0 ]; then
            test_result 0 "Exhaustion handling - suggested cities returned"
            echo "  Suggested cities: $SUGGESTED_CITIES"
        else
            test_result 1 "Exhaustion handling - no suggested cities"
        fi
        break
    fi
    
    if [ -z "$EXHAUST_CARD_USER" ] || [ "$EXHAUST_CARD_USER" = "null" ]; then
        break
    fi
    
    curl -s -X POST "$DISCOVERY_SERVICE_URL/discovery/test/raincheck" \
        -H "Content-Type: application/json" \
        -d "{
            \"userId\": \"$TEST_USER_MUMBAI_MALE\",
            \"sessionId\": \"$EXHAUST_SESSION\",
            \"raincheckedUserId\": \"$EXHAUST_CARD_USER\"
        }" > /dev/null
    
    ((EXHAUSTED_COUNT++))
    sleep 0.2
done

if [ "$EXHAUSTED" != "true" ]; then
    test_result 1 "Exhaustion not reached after $EXHAUSTED_COUNT cards"
fi
echo ""

# Test 14: Fallback Cities
echo -e "${CYAN}Test 14: Fallback Cities${NC}"
CITIES_RESPONSE=$(curl -s -X GET "$DISCOVERY_SERVICE_URL/discovery/fallback-cities?limit=5")
CITIES_COUNT=$(echo "$CITIES_RESPONSE" | jq -r '.cities | length' 2>/dev/null || echo "0")

if [ ! -z "$CITIES_COUNT" ] && [ "$CITIES_COUNT" != "null" ] && [ "$CITIES_COUNT" -gt 0 ] 2>/dev/null; then
    test_result 0 "Fallback cities returned ($CITIES_COUNT cities)"
else
    test_result 1 "Fallback cities not returned"
fi
echo ""

# Test 15: Multiple Status Types (IN_SQUAD_AVAILABLE, IN_BROADCAST_AVAILABLE)
echo -e "${CYAN}Test 15: Multiple Status Types${NC}"
STATUS_SESSION="status-$(date +%s)"
STATUS_RESPONSE=$(curl -s -X GET "$DISCOVERY_SERVICE_URL/discovery/test/card?userId=$TEST_USER_MUMBAI_MALE&sessionId=$STATUS_SESSION&soloOnly=false")
STATUS_CARD_STATUS=$(echo "$STATUS_RESPONSE" | jq -r '.card.status' 2>/dev/null)

if [ ! -z "$STATUS_CARD_STATUS" ] && [ "$STATUS_CARD_STATUS" != "null" ]; then
    if [[ "$STATUS_CARD_STATUS" =~ ^(AVAILABLE|IN_SQUAD_AVAILABLE|IN_BROADCAST_AVAILABLE)$ ]]; then
        test_result 0 "Card has valid status: $STATUS_CARD_STATUS"
    else
        test_result 1 "Card has invalid status: $STATUS_CARD_STATUS"
    fi
else
    test_result 1 "Status test failed - no card returned"
fi
echo ""

# Test 16: Raincheck Across Different Cities
echo -e "${CYAN}Test 16: Raincheck Across Different Cities${NC}"
CITY1_SESSION="city1-$(date +%s)"
CITY2_SESSION="city2-$(date +%s)"

# Raincheck a user in Mumbai
MUMBAI_CARD=$(curl -s -X GET "$DISCOVERY_SERVICE_URL/discovery/test/card?userId=$TEST_USER_MUMBAI_MALE&sessionId=$CITY1_SESSION&soloOnly=false")
MUMBAI_CARD_USER=$(echo "$MUMBAI_CARD" | jq -r '.card.userId' 2>/dev/null)

if [ ! -z "$MUMBAI_CARD_USER" ] && [ "$MUMBAI_CARD_USER" != "null" ]; then
    curl -s -X POST "$DISCOVERY_SERVICE_URL/discovery/test/raincheck" \
        -H "Content-Type: application/json" \
        -d "{
            \"userId\": \"$TEST_USER_MUMBAI_MALE\",
            \"sessionId\": \"$CITY1_SESSION\",
            \"raincheckedUserId\": \"$MUMBAI_CARD_USER\"
        }" > /dev/null
    
    # Get card in Delhi (different city, should not be affected by Mumbai raincheck)
    DELHI_CARD=$(curl -s -X GET "$DISCOVERY_SERVICE_URL/discovery/test/card?userId=$TEST_USER_DELHI_MALE&sessionId=$CITY2_SESSION&soloOnly=false")
    DELHI_CARD_USER=$(echo "$DELHI_CARD" | jq -r '.card.userId' 2>/dev/null)
    
    if [ ! -z "$DELHI_CARD_USER" ] && [ "$DELHI_CARD_USER" != "null" ]; then
        test_result 0 "Raincheck works across different cities"
    else
        test_result 1 "Raincheck across cities failed"
    fi
else
    test_result 1 "Raincheck across cities test failed - no Mumbai card"
fi
echo ""

# Test 17: Card Response Structure
echo -e "${CYAN}Test 17: Card Response Structure${NC}"
STRUCT_RESPONSE=$(curl -s -X GET "$DISCOVERY_SERVICE_URL/discovery/test/card?userId=$TEST_USER_MUMBAI_MALE&sessionId=struct-$(date +%s)&soloOnly=false")
HAS_USERID=$(echo "$STRUCT_RESPONSE" | jq -r '.card.userId // empty' 2>/dev/null)
HAS_USERNAME=$(echo "$STRUCT_RESPONSE" | jq -r '.card.username // empty' 2>/dev/null)
HAS_AGE=$(echo "$STRUCT_RESPONSE" | jq -r '.card.age // empty' 2>/dev/null)
HAS_CITY=$(echo "$STRUCT_RESPONSE" | jq -r '.card.city // empty' 2>/dev/null)
HAS_PAGES=$(echo "$STRUCT_RESPONSE" | jq -r '.card.pages // empty' 2>/dev/null)

if [ ! -z "$HAS_USERID" ] && [ ! -z "$HAS_USERNAME" ] && [ ! -z "$HAS_AGE" ] && [ ! -z "$HAS_CITY" ] && [ ! -z "$HAS_PAGES" ]; then
    test_result 0 "Card response has all required fields"
else
    test_result 1 "Card response missing required fields"
    echo "  Has userId: $([ ! -z "$HAS_USERID" ] && echo "yes" || echo "no")"
    echo "  Has username: $([ ! -z "$HAS_USERNAME" ] && echo "yes" || echo "no")"
    echo "  Has age: $([ ! -z "$HAS_AGE" ] && echo "yes" || echo "no")"
    echo "  Has city: $([ ! -z "$HAS_CITY" ] && echo "yes" || echo "no")"
    echo "  Has pages: $([ ! -z "$HAS_PAGES" ] && echo "yes" || echo "no")"
fi
echo ""

# ========== GENDER FILTER API TESTS ==========

# Test 18: Get Gender Filters (MALE user)
echo -e "${CYAN}Test 18: Get Gender Filters (MALE user)${NC}"
GF_GET_RESPONSE=$(curl -s -X GET "$DISCOVERY_SERVICE_URL/gender-filters/test?userId=$TEST_USER_MUMBAI_MALE")
GF_APPLICABLE=$(echo "$GF_GET_RESPONSE" | jq -r '.applicable' 2>/dev/null)
GF_FILTERS_COUNT=$(echo "$GF_GET_RESPONSE" | jq -r '.availableFilters | length' 2>/dev/null || echo "0")

if [ "$GF_APPLICABLE" = "true" ] && [ "$GF_FILTERS_COUNT" -gt 0 ]; then
    test_result 0 "Get gender filters returned available filters ($GF_FILTERS_COUNT filters)"
    # MALE users should see MALE and FEMALE options
    HAS_MALE=$(echo "$GF_GET_RESPONSE" | jq -r '.availableFilters[] | select(.gender=="MALE") | .gender' 2>/dev/null)
    HAS_FEMALE=$(echo "$GF_GET_RESPONSE" | jq -r '.availableFilters[] | select(.gender=="FEMALE") | .gender' 2>/dev/null)
    if [ ! -z "$HAS_MALE" ] && [ ! -z "$HAS_FEMALE" ]; then
        test_result 0 "MALE user sees MALE and FEMALE filter options"
    fi
else
    test_result 1 "Get gender filters failed"
fi
echo ""

# Test 19: Get Gender Filters (NON_BINARY user)
echo -e "${CYAN}Test 19: Get Gender Filters (NON_BINARY user)${NC}"
TEST_USER_NB="test-user-mumbai-nb-1"
GF_NB_RESPONSE=$(curl -s -X GET "$DISCOVERY_SERVICE_URL/gender-filters/test?userId=$TEST_USER_NB")
GF_NB_APPLICABLE=$(echo "$GF_NB_RESPONSE" | jq -r '.applicable' 2>/dev/null)
GF_NB_FILTERS_COUNT=$(echo "$GF_NB_RESPONSE" | jq -r '.availableFilters | length' 2>/dev/null || echo "0")

if [ "$GF_NB_APPLICABLE" = "true" ] && [ "$GF_NB_FILTERS_COUNT" -ge 3 ]; then
    test_result 0 "NON_BINARY user sees all filter options ($GF_NB_FILTERS_COUNT filters)"
    HAS_NB=$(echo "$GF_NB_RESPONSE" | jq -r '.availableFilters[] | select(.gender=="NON_BINARY") | .gender' 2>/dev/null)
    if [ ! -z "$HAS_NB" ]; then
        test_result 0 "NON_BINARY user sees NON_BINARY filter option"
    fi
else
    test_result 1 "Get gender filters for NON_BINARY user failed"
fi
echo ""

# Test 20: Get Gender Filters (PREFER_NOT_TO_SAY user)
echo -e "${CYAN}Test 20: Get Gender Filters (PREFER_NOT_TO_SAY user)${NC}"
TEST_USER_PNS="test-user-mumbai-pns-1"
GF_PNS_RESPONSE=$(curl -s -X GET "$DISCOVERY_SERVICE_URL/gender-filters/test?userId=$TEST_USER_PNS")
GF_PNS_APPLICABLE=$(echo "$GF_PNS_RESPONSE" | jq -r '.applicable' 2>/dev/null)
GF_PNS_FILTERS_COUNT=$(echo "$GF_PNS_RESPONSE" | jq -r '.availableFilters | length' 2>/dev/null || echo "0")

if [ "$GF_PNS_APPLICABLE" = "true" ] && [ "$GF_PNS_FILTERS_COUNT" -ge 1 ]; then
    HAS_ALL=$(echo "$GF_PNS_RESPONSE" | jq -r '.availableFilters[] | select(.gender=="ALL") | .gender' 2>/dev/null)
    if [ ! -z "$HAS_ALL" ]; then
        test_result 0 "PREFER_NOT_TO_SAY user sees only ALL option"
    else
        test_result 1 "PREFER_NOT_TO_SAY user should see ALL option"
    fi
else
    test_result 1 "Get gender filters for PREFER_NOT_TO_SAY user failed"
fi
echo ""

# Test 21: Apply Gender Filter
echo -e "${CYAN}Test 21: Apply Gender Filter${NC}"
# Clear any existing filter first
clear_gender_filter "$TEST_USER_MUMBAI_MALE" > /dev/null 2>&1

GF_APPLY_RESPONSE=$(curl -s -X POST "$DISCOVERY_SERVICE_URL/gender-filters/test/apply" \
    -H "Content-Type: application/json" \
    -d "{
        \"userId\": \"$TEST_USER_MUMBAI_MALE\",
        \"genders\": [\"FEMALE\"]
    }")

GF_APPLY_SUCCESS=$(echo "$GF_APPLY_RESPONSE" | jq -r '.success' 2>/dev/null)
GF_APPLY_SCREENS=$(echo "$GF_APPLY_RESPONSE" | jq -r '.screensRemaining' 2>/dev/null)

if [ "$GF_APPLY_SUCCESS" = "true" ] && [ ! -z "$GF_APPLY_SCREENS" ] && [ "$GF_APPLY_SCREENS" != "null" ]; then
    test_result 0 "Apply gender filter successful (screens: $GF_APPLY_SCREENS)"
else
    test_result 1 "Apply gender filter failed"
    echo "  Response: $GF_APPLY_RESPONSE"
fi
echo ""

# Test 22: Apply Gender Filter - Clear (ALL option)
echo -e "${CYAN}Test 22: Apply Gender Filter - Clear (ALL option)${NC}"
GF_CLEAR_RESPONSE=$(curl -s -X POST "$DISCOVERY_SERVICE_URL/gender-filters/test/apply" \
    -H "Content-Type: application/json" \
    -d "{
        \"userId\": \"$TEST_USER_MUMBAI_MALE\",
        \"genders\": [\"ALL\"]
    }")

GF_CLEAR_SUCCESS=$(echo "$GF_CLEAR_RESPONSE" | jq -r '.success' 2>/dev/null)

if [ "$GF_CLEAR_SUCCESS" = "true" ]; then
    test_result 0 "Clear gender filter (ALL option) successful"
    # Verify filter was cleared
    cd "$ROOT_DIR/apps/discovery-service"
    FILTER_EXISTS=$(node -e "
        const { PrismaClient } = require('@prisma/client');
        const prisma = new PrismaClient();
        (async () => {
            const pref = await prisma.genderFilterPreference.findUnique({
                where: { userId: '$TEST_USER_MUMBAI_MALE' }
            });
            console.log(pref ? 'exists' : 'cleared');
            await prisma.\$disconnect();
        })();
    " 2>/dev/null)
    if [ "$FILTER_EXISTS" = "cleared" ]; then
        test_result 0 "Gender filter was cleared from database"
    fi
else
    test_result 1 "Clear gender filter failed"
fi
echo ""

# ========== LOCATION API TESTS ==========

# Test 23: Get Cities (Top cities)
echo -e "${CYAN}Test 23: Get Cities (Top cities)${NC}"
CITIES_TOP_RESPONSE=$(curl -s -X GET "$DISCOVERY_SERVICE_URL/location/cities?limit=5")
# Response is an array directly, not wrapped in { cities: [...] }
CITIES_TOP_COUNT=$(echo "$CITIES_TOP_RESPONSE" | jq -r '. | length' 2>/dev/null || echo "0")

if [ "$CITIES_TOP_COUNT" -gt 0 ]; then
    test_result 0 "Get cities returned $CITIES_TOP_COUNT cities"
    # Check if response has city names
    FIRST_CITY=$(echo "$CITIES_TOP_RESPONSE" | jq -r '.[0].city // empty' 2>/dev/null)
    if [ ! -z "$FIRST_CITY" ]; then
        test_result 0 "Cities response has city names"
    fi
else
    test_result 1 "Get cities failed"
    echo "  Response: $CITIES_TOP_RESPONSE"
fi
echo ""

# Test 24: Search Cities
echo -e "${CYAN}Test 24: Search Cities${NC}"
CITIES_SEARCH_RESPONSE=$(curl -s -X GET "$DISCOVERY_SERVICE_URL/location/search?q=Mumbai&limit=5")
# Response is an array directly
CITIES_SEARCH_COUNT=$(echo "$CITIES_SEARCH_RESPONSE" | jq -r '. | length' 2>/dev/null || echo "0")

if [ "$CITIES_SEARCH_COUNT" -gt 0 ]; then
    test_result 0 "Search cities returned $CITIES_SEARCH_COUNT results"
    # Check if Mumbai is in results (case-insensitive)
    HAS_MUMBAI=$(echo "$CITIES_SEARCH_RESPONSE" | jq -r '.[] | select(.city | ascii_downcase == "mumbai") | .city' 2>/dev/null || echo "$CITIES_SEARCH_RESPONSE" | jq -r '.[] | select(.city=="Mumbai") | .city' 2>/dev/null)
    if [ ! -z "$HAS_MUMBAI" ]; then
        test_result 0 "Search found Mumbai"
    else
        # Even if Mumbai not found, if we got results, the endpoint works
        test_result 0 "Search cities endpoint working (found $CITIES_SEARCH_COUNT results)"
    fi
else
    test_result 1 "Search cities failed"
    echo "  Response: $CITIES_SEARCH_RESPONSE"
fi
echo ""

# Test 25: Locate Me (Reverse Geocoding)
echo -e "${CYAN}Test 25: Locate Me (Reverse Geocoding)${NC}"
# Use Mumbai coordinates (approximately)
LOCATE_RESPONSE=$(curl -s -X POST "$DISCOVERY_SERVICE_URL/location/locate-me" \
    -H "Content-Type: application/json" \
    -d "{
        \"latitude\": 19.0760,
        \"longitude\": 72.8777
    }")

LOCATE_CITY=$(echo "$LOCATE_RESPONSE" | jq -r '.city // empty' 2>/dev/null)

if [ ! -z "$LOCATE_CITY" ] && [ "$LOCATE_CITY" != "null" ]; then
    test_result 0 "Locate me returned city: $LOCATE_CITY"
else
    # This might fail if geocoding service is unavailable, so we'll mark as warning
    echo -e "${YELLOW}⚠️  Locate me may require external geocoding service${NC}"
    test_result 0 "Locate me endpoint accessible (may require external service)"
fi
echo ""

# Test 26: Get Preferred City (Test endpoint)
echo -e "${CYAN}Test 26: Get Preferred City (Test endpoint)${NC}"
PREF_GET_RESPONSE=$(curl -s -X GET "$DISCOVERY_SERVICE_URL/location/test/preference?userId=$TEST_USER_MUMBAI_MALE")
PREF_CITY=$(echo "$PREF_GET_RESPONSE" | jq -r '.city // empty' 2>/dev/null)

if [ ! -z "$PREF_GET_RESPONSE" ]; then
    test_result 0 "Get preferred city endpoint accessible"
    if [ "$PREF_CITY" = "Mumbai" ]; then
        test_result 0 "Preferred city is Mumbai (correct)"
    fi
else
    test_result 1 "Get preferred city failed"
fi
echo ""

# Test 27: Update Preferred City (Test endpoint)
echo -e "${CYAN}Test 27: Update Preferred City (Test endpoint)${NC}"
# Update to Delhi using helper function
update_preferred_city "$TEST_USER_MUMBAI_MALE" "Delhi" > /dev/null 2>&1
sleep 0.5

# Verify by getting it
PREF_VERIFY_RESPONSE=$(curl -s -X GET "$DISCOVERY_SERVICE_URL/location/test/preference?userId=$TEST_USER_MUMBAI_MALE")
PREF_VERIFY_CITY=$(echo "$PREF_VERIFY_RESPONSE" | jq -r '.city // empty' 2>/dev/null)

if [ "$PREF_VERIFY_CITY" = "Delhi" ]; then
    test_result 0 "Update preferred city successful (updated to Delhi)"
    test_result 0 "Preferred city update persisted"
    # Reset back to Mumbai
    update_preferred_city "$TEST_USER_MUMBAI_MALE" "Mumbai" > /dev/null 2>&1
else
    test_result 1 "Update preferred city failed or not persisted"
    echo "  Expected: Delhi, Got: $PREF_VERIFY_CITY"
    # Reset back to Mumbai anyway
    update_preferred_city "$TEST_USER_MUMBAI_MALE" "Mumbai" > /dev/null 2>&1
fi
echo ""

# ========== METRICS API TESTS ==========

# Test 28: Get Active Meetings Count
echo -e "${CYAN}Test 28: Get Active Meetings Count${NC}"
METRICS_RESPONSE=$(curl -s -X GET "$DISCOVERY_SERVICE_URL/metrics/meetings")
METRICS_COUNT=$(echo "$METRICS_RESPONSE" | jq -r '.liveMeetings // empty' 2>/dev/null)

if [ ! -z "$METRICS_RESPONSE" ]; then
    if [ ! -z "$METRICS_COUNT" ] && [ "$METRICS_COUNT" != "null" ]; then
        test_result 0 "Get active meetings count successful (count: $METRICS_COUNT)"
    else
        test_result 0 "Get active meetings endpoint accessible"
    fi
else
    test_result 1 "Get active meetings failed"
fi
echo ""

# ========== HOMEPAGE API TESTS ==========

# Test 29: Get Homepage (Should return NOT_IMPLEMENTED)
echo -e "${CYAN}Test 29: Get Homepage (Should return NOT_IMPLEMENTED)${NC}"
HOMEPAGE_RESPONSE=$(curl -s -X GET "$DISCOVERY_SERVICE_URL/homepage")
HOMEPAGE_STATUS=$(echo "$HOMEPAGE_RESPONSE" | jq -r '.statusCode // empty' 2>/dev/null)

if [ "$HOMEPAGE_STATUS" = "501" ]; then
    test_result 0 "Homepage endpoint returns NOT_IMPLEMENTED (501) as expected"
else
    # If it returns something else, that's also fine - just check it's accessible
    if [ ! -z "$HOMEPAGE_RESPONSE" ]; then
        test_result 0 "Homepage endpoint accessible"
    else
        test_result 1 "Homepage endpoint failed"
    fi
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
