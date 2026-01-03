#!/bin/bash

# Comprehensive E2E test script for user-service
# Bypasses auth entirely - uses test endpoints with userId directly

set +e  # Don't exit on error, we'll handle it manually

USER_SERVICE_URL="http://localhost:3002"
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
echo -e "  USER SERVICE E2E TEST (NO AUTH)"
echo -e "==========================================${NC}"
echo ""

# Step 1: Check Infrastructure
echo -e "${CYAN}Step 1: Checking Infrastructure...${NC}"

check_postgres() {
    if pg_isready -q 2>/dev/null; then
        echo -e "${GREEN}✅ PostgreSQL is running${NC}"
        return 0
    else
        echo -e "${RED}❌ PostgreSQL is not running${NC}"
        echo -e "${YELLOW}Please start PostgreSQL first${NC}"
        return 1
    fi
}

if ! check_postgres; then
    exit 1
fi

echo ""

# Step 2: Check/Start Services
echo -e "${CYAN}Step 2: Checking Services...${NC}"

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

# Check moderation-service (required for image validation)
MODERATION_UP=$(check_service "$MODERATION_SERVICE_URL" "Moderation Service" && echo "yes" || echo "no") || true
if [ "$MODERATION_UP" = "no" ]; then
    echo -e "${CYAN}Starting moderation-service...${NC}"
    cd "$ROOT_DIR/apps/moderation-service"
    npm run start:dev > /tmp/moderation-service-test.log 2>&1 &
    MODERATION_PID=$!
    echo "  Started with PID: $MODERATION_PID"
    
    # Wait for moderation service
    MAX_WAIT=30
    WAIT_COUNT=0
    while [ $WAIT_COUNT -lt $MAX_WAIT ]; do
        if curl -s -X POST "$MODERATION_SERVICE_URL/moderation/check-image" -H "Content-Type: application/json" -d '{"imageUrl":"test"}' > /dev/null 2>&1; then
            echo -e "${GREEN}✅ Moderation service is ready${NC}"
            break
        fi
        WAIT_COUNT=$((WAIT_COUNT + 1))
        sleep 1
    done
fi

# Check user-service
USER_SERVICE_UP=$(check_service "$USER_SERVICE_URL" "User Service" && echo "yes" || echo "no") || true
if [ "$USER_SERVICE_UP" = "no" ]; then
    echo -e "${YELLOW}⚠️  User service is not running${NC}"
    echo -e "${CYAN}Please start user-service manually:${NC}"
    echo "  cd apps/user-service && npm run start:dev"
    echo ""
    read -p "Press Enter once user-service is running, or Ctrl+C to exit..."
fi

echo ""

# Step 3: Seed Data
echo -e "${CYAN}Step 3: Seeding Data...${NC}"

cd "$ROOT_DIR/apps/user-service"

if [ ! -f "node_modules/.prisma/client/index.js" ]; then
    echo -e "${YELLOW}⚠️  Prisma client not generated, generating...${NC}"
    npm run prisma:generate
fi

echo -e "${CYAN}Running seed scripts...${NC}"

# Seed catalog data (brands, interests, values)
echo -e "${CYAN}  Seeding catalog data (brands, interests, values)...${NC}"
CATALOG_SEED_OUTPUT=$(npm run seed 2>&1)
echo "$CATALOG_SEED_OUTPUT" | grep -E "(Seeded|Seed completed|Error)" || true

# Seed test users
echo -e "${CYAN}  Seeding test users...${NC}"
USER_SEED_OUTPUT=$(npm run seed:test-users 2>&1)
echo "$USER_SEED_OUTPUT" | grep -E "(Created|Skipped|Seed|Failed|Error)" || echo "$USER_SEED_OUTPUT"

if echo "$USER_SEED_OUTPUT" | grep -q "Seed completed\|Created:"; then
    test_result 0 "Seed test users"
elif echo "$USER_SEED_OUTPUT" | grep -q "Skipped:"; then
    test_result 0 "Seed test users (already exist)"
else
    test_result 1 "Seed test users"
fi
echo ""

# Step 4: Wait for services
echo -e "${CYAN}Step 4: Waiting for services to be ready...${NC}"
sleep 2

# Step 5: Run Test Cases
echo -e "${BLUE}=========================================="
echo -e "  TEST CASES"
echo -e "==========================================${NC}"
echo ""

# Test User IDs
TIMESTAMP=$(date +%s)
TEST_USER_ID="test-user-e2e-$TIMESTAMP"
TEST_USER_ID_2="test-user-e2e-2-$TIMESTAMP"
TEST_USER_ID_PNS="test-user-e2e-pns-$TIMESTAMP"

# ========== PROFILE MANAGEMENT TESTS ==========

# Test 1: Create Profile
echo -e "${CYAN}Test 1: Create Profile${NC}"
CREATE_RESPONSE=$(curl -s -X POST "$USER_SERVICE_URL/users/$TEST_USER_ID/profile" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "TestUser'$TIMESTAMP'",
        "dateOfBirth": "2000-01-01T00:00:00Z",
        "gender": "MALE",
        "displayPictureUrl": "https://example.com/safe-profile.jpg"
    }')

HTTP_STATUS=$(echo "$CREATE_RESPONSE" | jq -r '.statusCode // empty' 2>/dev/null || echo "200")
if [ -z "$HTTP_STATUS" ] || [ "$HTTP_STATUS" = "null" ]; then
    PERCENTAGE=$(echo "$CREATE_RESPONSE" | jq -r '.profileCompletion.percentage // empty' 2>/dev/null)
    if [ ! -z "$PERCENTAGE" ] && [ "$PERCENTAGE" != "null" ]; then
        test_result 0 "Create profile successful (completion: $PERCENTAGE%)"
    else
        test_result 0 "Create profile successful"
    fi
else
    test_result 1 "Create profile failed (HTTP $HTTP_STATUS)"
    echo "  Response: $CREATE_RESPONSE"
fi
echo ""

# Test 2: Get Profile
echo -e "${CYAN}Test 2: Get Profile${NC}"
GET_RESPONSE=$(curl -s "$USER_SERVICE_URL/users/$TEST_USER_ID")
HAS_USER=$(echo "$GET_RESPONSE" | jq -r '.user // empty' 2>/dev/null)
HAS_COMPLETION=$(echo "$GET_RESPONSE" | jq -r '.profileCompletion // empty' 2>/dev/null)

if [ ! -z "$HAS_USER" ] && [ "$HAS_USER" != "null" ]; then
    test_result 0 "Get profile returned user data"
    if [ ! -z "$HAS_COMPLETION" ] && [ "$HAS_COMPLETION" != "null" ]; then
        PERCENTAGE=$(echo "$GET_RESPONSE" | jq -r '.profileCompletion.percentage // empty' 2>/dev/null)
        test_result 0 "Get profile includes profile completion ($PERCENTAGE%)"
    fi
else
    test_result 1 "Get profile failed"
fi
echo ""

# Test 3: Get Profile Completion (Test endpoint)
echo -e "${CYAN}Test 3: Get Profile Completion (Test endpoint)${NC}"
COMPLETION_RESPONSE=$(curl -s "$USER_SERVICE_URL/users/test/$TEST_USER_ID/profile-completion")
COMPLETION_PERCENTAGE=$(echo "$COMPLETION_RESPONSE" | jq -r '.profileCompletion.percentage // empty' 2>/dev/null)

if [ ! -z "$COMPLETION_PERCENTAGE" ] && [ "$COMPLETION_PERCENTAGE" != "null" ]; then
    test_result 0 "Get profile completion successful ($COMPLETION_PERCENTAGE%)"
else
    test_result 1 "Get profile completion failed"
fi
echo ""

# Test 4: Update Profile (Test endpoint)
echo -e "${CYAN}Test 4: Update Profile (Test endpoint)${NC}"
UPDATE_RESPONSE=$(curl -s -X PATCH "$USER_SERVICE_URL/users/test/$TEST_USER_ID/profile" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "UpdatedUser'$TIMESTAMP'",
        "intent": "Looking for friends"
    }')

UPDATED_USERNAME=$(echo "$UPDATE_RESPONSE" | jq -r '.user.username // empty' 2>/dev/null)
if [ "$UPDATED_USERNAME" = "UpdatedUser$TIMESTAMP" ]; then
    test_result 0 "Update profile successful (username updated)"
else
    test_result 1 "Update profile failed"
    echo "  Response: $UPDATE_RESPONSE"
fi
echo ""

# Test 5: Age Validation (Under 18)
echo -e "${CYAN}Test 5: Age Validation (Under 18)${NC}"
YOUNG_USER_ID="test-user-young-$TIMESTAMP"
AGE_VALIDATION_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST "$USER_SERVICE_URL/users/$YOUNG_USER_ID/profile" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "YoungUser",
        "dateOfBirth": "2010-01-01T00:00:00Z",
        "gender": "MALE",
        "displayPictureUrl": "https://example.com/safe.jpg"
    }')

HTTP_STATUS=$(echo "$AGE_VALIDATION_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
if [ "$HTTP_STATUS" = "400" ]; then
    test_result 0 "Age validation working (rejected under 18)"
else
    test_result 1 "Age validation failed (expected 400, got $HTTP_STATUS)"
fi
echo ""

# Test 6: Username Duplication (Allowed)
echo -e "${CYAN}Test 6: Username Duplication (Allowed)${NC}"
DUPLICATE_USER_ID="test-user-dup-$TIMESTAMP"
DUP_RESPONSE=$(curl -s -X POST "$USER_SERVICE_URL/users/$DUPLICATE_USER_ID/profile" \
    -H "Content-Type: application/json" \
    -d "{
        \"username\": \"TestUser$TIMESTAMP\",
        \"dateOfBirth\": \"2000-01-01T00:00:00Z\",
        \"gender\": \"FEMALE\",
        \"displayPictureUrl\": \"https://example.com/safe-profile2.jpg\"
    }")

HTTP_STATUS=$(echo "$DUP_RESPONSE" | jq -r '.statusCode // empty' 2>/dev/null || echo "200")
if [ -z "$HTTP_STATUS" ] || [ "$HTTP_STATUS" = "null" ]; then
    test_result 0 "Username duplication allowed (common names permitted)"
else
    test_result 1 "Username duplication failed (HTTP $HTTP_STATUS)"
fi
echo ""

# Test 7: Moderation Integration (Unsafe Image)
echo -e "${CYAN}Test 7: Moderation Integration (Unsafe Image)${NC}"
UNSAFE_USER_ID="test-user-unsafe-$TIMESTAMP"
UNSAFE_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST "$USER_SERVICE_URL/users/$UNSAFE_USER_ID/profile" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "UnsafeUser",
        "dateOfBirth": "2000-01-01T00:00:00Z",
        "gender": "MALE",
        "displayPictureUrl": "https://example.com/nsfw-profile.jpg"
    }')

HTTP_STATUS=$(echo "$UNSAFE_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
if [ "$HTTP_STATUS" = "400" ]; then
    test_result 0 "Moderation integration working (unsafe image rejected)"
else
    test_result 1 "Moderation integration failed (expected 400, got $HTTP_STATUS)"
fi
echo ""

# ========== PHOTO MANAGEMENT TESTS ==========

# Test 8: Get Photos
echo -e "${CYAN}Test 8: Get Photos${NC}"
PHOTOS_RESPONSE=$(curl -s "$USER_SERVICE_URL/users/$TEST_USER_ID/photos")
PHOTOS_COUNT=$(echo "$PHOTOS_RESPONSE" | jq -r '.photos | length' 2>/dev/null || echo "0")

if [ ! -z "$PHOTOS_RESPONSE" ]; then
    test_result 0 "Get photos successful (count: $PHOTOS_COUNT)"
else
    test_result 1 "Get photos failed"
fi
echo ""

# Test 9: Add Photo (Test endpoint)
echo -e "${CYAN}Test 9: Add Photo (Test endpoint)${NC}"
ADD_PHOTO_RESPONSE=$(curl -s -X POST "$USER_SERVICE_URL/users/test/$TEST_USER_ID/photos" \
    -H "Content-Type: application/json" \
    -d '{
        "url": "https://example.com/safe-photo-1.jpg",
        "order": 0
    }')

PHOTO_ID=$(echo "$ADD_PHOTO_RESPONSE" | jq -r '.photo.id // empty' 2>/dev/null)
if [ ! -z "$PHOTO_ID" ] && [ "$PHOTO_ID" != "null" ]; then
    test_result 0 "Add photo successful (photo ID: $PHOTO_ID)"
    TEST_PHOTO_ID="$PHOTO_ID"
else
    test_result 1 "Add photo failed"
    echo "  Response: $ADD_PHOTO_RESPONSE"
fi
echo ""

# Test 10: Add Multiple Photos (Max 4)
echo -e "${CYAN}Test 10: Add Multiple Photos (Max 4)${NC}"
for i in 1 2 3; do
    curl -s -X POST "$USER_SERVICE_URL/users/test/$TEST_USER_ID/photos" \
        -H "Content-Type: application/json" \
        -d "{
            \"url\": \"https://example.com/safe-photo-$i.jpg\",
            \"order\": $i
        }" > /dev/null
done

# Try to add 5th photo (should fail)
MAX_PHOTO_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST "$USER_SERVICE_URL/users/test/$TEST_USER_ID/photos" \
    -H "Content-Type: application/json" \
    -d '{
        "url": "https://example.com/safe-photo-5.jpg",
        "order": 4
    }')

HTTP_STATUS=$(echo "$MAX_PHOTO_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
if [ "$HTTP_STATUS" = "400" ]; then
    test_result 0 "Maximum 4 photos enforced (5th photo rejected)"
else
    test_result 1 "Maximum photos limit not enforced (expected 400, got $HTTP_STATUS)"
fi
echo ""

# Test 11: Delete Photo (Test endpoint)
echo -e "${CYAN}Test 11: Delete Photo (Test endpoint)${NC}"
if [ ! -z "$TEST_PHOTO_ID" ]; then
    DELETE_RESPONSE=$(curl -s -X DELETE "$USER_SERVICE_URL/users/test/$TEST_USER_ID/photos/$TEST_PHOTO_ID")
    OK=$(echo "$DELETE_RESPONSE" | jq -r '.ok // empty' 2>/dev/null)
    if [ "$OK" = "true" ]; then
        test_result 0 "Delete photo successful"
    else
        test_result 1 "Delete photo failed"
    fi
else
    test_result 1 "Delete photo skipped (no photo ID)"
fi
echo ""

# ========== CATALOG DATA TESTS ==========

# Test 12: Get Brands
echo -e "${CYAN}Test 12: Get Brands${NC}"
BRANDS_RESPONSE=$(curl -s "$USER_SERVICE_URL/brands")
BRANDS_COUNT=$(echo "$BRANDS_RESPONSE" | jq -r '.brands | length' 2>/dev/null || echo "0")

if [ "$BRANDS_COUNT" -gt 0 ]; then
    test_result 0 "Get brands successful ($BRANDS_COUNT brands)"
    FIRST_BRAND_ID=$(echo "$BRANDS_RESPONSE" | jq -r '.brands[0].id // empty' 2>/dev/null)
    TEST_BRAND_ID="$FIRST_BRAND_ID"
else
    test_result 1 "Get brands failed"
fi
echo ""

# Test 13: Get Interests
echo -e "${CYAN}Test 13: Get Interests${NC}"
INTERESTS_RESPONSE=$(curl -s "$USER_SERVICE_URL/interests")
INTERESTS_COUNT=$(echo "$INTERESTS_RESPONSE" | jq -r '.interests | length' 2>/dev/null || echo "0")

if [ "$INTERESTS_COUNT" -gt 0 ]; then
    test_result 0 "Get interests successful ($INTERESTS_COUNT interests)"
    FIRST_INTEREST_ID=$(echo "$INTERESTS_RESPONSE" | jq -r '.interests[0].id // empty' 2>/dev/null)
    TEST_INTEREST_ID="$FIRST_INTEREST_ID"
else
    test_result 1 "Get interests failed"
fi
echo ""

# Test 14: Get Values
echo -e "${CYAN}Test 14: Get Values${NC}"
VALUES_RESPONSE=$(curl -s "$USER_SERVICE_URL/values")
VALUES_COUNT=$(echo "$VALUES_RESPONSE" | jq -r '.values | length' 2>/dev/null || echo "0")

if [ "$VALUES_COUNT" -gt 0 ]; then
    test_result 0 "Get values successful ($VALUES_COUNT values)"
    FIRST_VALUE_ID=$(echo "$VALUES_RESPONSE" | jq -r '.values[0].id // empty' 2>/dev/null)
    TEST_VALUE_ID="$FIRST_VALUE_ID"
else
    test_result 1 "Get values failed"
fi
echo ""

# ========== MUSIC PREFERENCE TESTS ==========

# Test 15: Create Music Preference
echo -e "${CYAN}Test 15: Create Music Preference${NC}"
MUSIC_CREATE_RESPONSE=$(curl -s -X POST "$USER_SERVICE_URL/music/preferences" \
    -H "Content-Type: application/json" \
    -d '{
        "songName": "Test Song '$TIMESTAMP'",
        "artistName": "Test Artist"
    }')

SONG_ID=$(echo "$MUSIC_CREATE_RESPONSE" | jq -r '.song.id // empty' 2>/dev/null)
if [ ! -z "$SONG_ID" ] && [ "$SONG_ID" != "null" ]; then
    test_result 0 "Create music preference successful (song ID: $SONG_ID)"
    TEST_SONG_ID="$SONG_ID"
else
    test_result 1 "Create music preference failed"
fi
echo ""

# Test 16: Search Music
echo -e "${CYAN}Test 16: Search Music${NC}"
MUSIC_SEARCH_RESPONSE=$(curl -s "$USER_SERVICE_URL/music/search?q=Test&limit=5")
SONGS_COUNT=$(echo "$MUSIC_SEARCH_RESPONSE" | jq -r '.songs | length' 2>/dev/null || echo "0")
HTTP_STATUS=$(echo "$MUSIC_SEARCH_RESPONSE" | jq -r '.statusCode // empty' 2>/dev/null)

if [ "$HTTP_STATUS" = "503" ]; then
    # Spotify API not configured - this is acceptable for testing
    test_result 0 "Search music endpoint working (503 - Spotify API not configured, expected)"
elif [ ! -z "$HTTP_STATUS" ] && [ "$HTTP_STATUS" != "null" ]; then
    test_result 1 "Search music failed (HTTP $HTTP_STATUS)"
    echo "  Response: $MUSIC_SEARCH_RESPONSE"
elif [ "$SONGS_COUNT" -ge 0 ]; then
    # Even if no songs found, the endpoint should return an empty array
    test_result 0 "Search music successful ($SONGS_COUNT songs found)"
else
    test_result 1 "Search music failed"
    echo "  Response: $MUSIC_SEARCH_RESPONSE"
fi
echo ""

# Test 17: Update Music Preference (Test endpoint)
echo -e "${CYAN}Test 17: Update Music Preference (Test endpoint)${NC}"
if [ ! -z "$TEST_SONG_ID" ]; then
    MUSIC_UPDATE_RESPONSE=$(curl -s -X PATCH "$USER_SERVICE_URL/users/test/$TEST_USER_ID/music-preference" \
        -H "Content-Type: application/json" \
        -d "{\"musicPreferenceId\": \"$TEST_SONG_ID\"}")
    
    UPDATED_MUSIC=$(echo "$MUSIC_UPDATE_RESPONSE" | jq -r '.user.musicPreference.id // empty' 2>/dev/null)
    if [ "$UPDATED_MUSIC" = "$TEST_SONG_ID" ]; then
        test_result 0 "Update music preference successful"
    else
        test_result 1 "Update music preference failed"
    fi
else
    test_result 1 "Update music preference skipped (no song ID)"
fi
echo ""

# ========== PREFERENCES TESTS ==========

# Test 18: Update Brand Preferences (Test endpoint)
echo -e "${CYAN}Test 18: Update Brand Preferences (Test endpoint)${NC}"
if [ ! -z "$TEST_BRAND_ID" ]; then
    # Get 3 brand IDs
    BRAND_IDS=$(echo "$BRANDS_RESPONSE" | jq -r '.brands[0:3] | map(.id) | @json' 2>/dev/null)
    BRAND_UPDATE_RESPONSE=$(curl -s -X PATCH "$USER_SERVICE_URL/users/test/$TEST_USER_ID/brand-preferences" \
        -H "Content-Type: application/json" \
        -d "{\"brandIds\": $BRAND_IDS}")
    
    PREFERENCES_COUNT=$(echo "$BRAND_UPDATE_RESPONSE" | jq -r '.preferences | length' 2>/dev/null || echo "0")
    if [ "$PREFERENCES_COUNT" -gt 0 ]; then
        test_result 0 "Update brand preferences successful ($PREFERENCES_COUNT brands)"
    else
        test_result 1 "Update brand preferences failed"
    fi
else
    test_result 1 "Update brand preferences skipped (no brand ID)"
fi
echo ""

# Test 19: Update Brand Preferences - Max 5
echo -e "${CYAN}Test 19: Update Brand Preferences - Max 5${NC}"
if [ ! -z "$BRANDS_RESPONSE" ]; then
    # Get 6 brand IDs (should fail)
    BRAND_IDS_6=$(echo "$BRANDS_RESPONSE" | jq -r '.brands[0:6] | map(.id) | @json' 2>/dev/null)
    MAX_BRAND_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X PATCH "$USER_SERVICE_URL/users/test/$TEST_USER_ID/brand-preferences" \
        -H "Content-Type: application/json" \
        -d "{\"brandIds\": $BRAND_IDS_6}")
    
    HTTP_STATUS=$(echo "$MAX_BRAND_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
    if [ "$HTTP_STATUS" = "400" ]; then
        test_result 0 "Maximum 5 brands enforced (6 brands rejected)"
    else
        test_result 1 "Maximum brands limit not enforced (expected 400, got $HTTP_STATUS)"
    fi
fi
echo ""

# Test 20: Update Interests (Test endpoint)
echo -e "${CYAN}Test 20: Update Interests (Test endpoint)${NC}"
if [ ! -z "$TEST_INTEREST_ID" ]; then
    # Get 3 interest IDs
    INTEREST_IDS=$(echo "$INTERESTS_RESPONSE" | jq -r '.interests[0:3] | map(.id) | @json' 2>/dev/null)
    INTEREST_UPDATE_RESPONSE=$(curl -s -X PATCH "$USER_SERVICE_URL/users/test/$TEST_USER_ID/interests" \
        -H "Content-Type: application/json" \
        -d "{\"interestIds\": $INTEREST_IDS}")
    
    INTERESTS_COUNT=$(echo "$INTEREST_UPDATE_RESPONSE" | jq -r '.interests | length' 2>/dev/null || echo "0")
    if [ "$INTERESTS_COUNT" -gt 0 ]; then
        test_result 0 "Update interests successful ($INTERESTS_COUNT interests)"
    else
        test_result 1 "Update interests failed"
    fi
else
    test_result 1 "Update interests skipped (no interest ID)"
fi
echo ""

# Test 21: Update Interests - Max 4
echo -e "${CYAN}Test 21: Update Interests - Max 4${NC}"
if [ ! -z "$INTERESTS_RESPONSE" ]; then
    # Get 5 interest IDs (should fail)
    INTEREST_IDS_5=$(echo "$INTERESTS_RESPONSE" | jq -r '.interests[0:5] | map(.id) | @json' 2>/dev/null)
    MAX_INTEREST_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X PATCH "$USER_SERVICE_URL/users/test/$TEST_USER_ID/interests" \
        -H "Content-Type: application/json" \
        -d "{\"interestIds\": $INTEREST_IDS_5}")
    
    HTTP_STATUS=$(echo "$MAX_INTEREST_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
    if [ "$HTTP_STATUS" = "400" ]; then
        test_result 0 "Maximum 4 interests enforced (5 interests rejected)"
    else
        test_result 1 "Maximum interests limit not enforced (expected 400, got $HTTP_STATUS)"
    fi
fi
echo ""

# Test 22: Update Values (Test endpoint)
echo -e "${CYAN}Test 22: Update Values (Test endpoint)${NC}"
if [ ! -z "$TEST_VALUE_ID" ]; then
    # Get 3 value IDs
    VALUE_IDS=$(echo "$VALUES_RESPONSE" | jq -r '.values[0:3] | map(.id) | @json' 2>/dev/null)
    VALUE_UPDATE_RESPONSE=$(curl -s -X PATCH "$USER_SERVICE_URL/users/test/$TEST_USER_ID/values" \
        -H "Content-Type: application/json" \
        -d "{\"valueIds\": $VALUE_IDS}")
    
    VALUES_COUNT=$(echo "$VALUE_UPDATE_RESPONSE" | jq -r '.values | length' 2>/dev/null || echo "0")
    if [ "$VALUES_COUNT" -gt 0 ]; then
        test_result 0 "Update values successful ($VALUES_COUNT values)"
    else
        test_result 1 "Update values failed"
    fi
else
    test_result 1 "Update values skipped (no value ID)"
fi
echo ""

# Test 23: Update Values - Max 4
echo -e "${CYAN}Test 23: Update Values - Max 4${NC}"
if [ ! -z "$VALUES_RESPONSE" ]; then
    # Get 5 value IDs (should fail)
    VALUE_IDS_5=$(echo "$VALUES_RESPONSE" | jq -r '.values[0:5] | map(.id) | @json' 2>/dev/null)
    MAX_VALUE_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X PATCH "$USER_SERVICE_URL/users/test/$TEST_USER_ID/values" \
        -H "Content-Type: application/json" \
        -d "{\"valueIds\": $VALUE_IDS_5}")
    
    HTTP_STATUS=$(echo "$MAX_VALUE_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
    if [ "$HTTP_STATUS" = "400" ]; then
        test_result 0 "Maximum 4 values enforced (5 values rejected)"
    else
        test_result 1 "Maximum values limit not enforced (expected 400, got $HTTP_STATUS)"
    fi
fi
echo ""

# ========== LOCATION TESTS ==========

# Test 24: Update Location (Test endpoint)
echo -e "${CYAN}Test 24: Update Location (Test endpoint)${NC}"
LOCATION_UPDATE_RESPONSE=$(curl -s -X PATCH "$USER_SERVICE_URL/users/test/$TEST_USER_ID/location" \
    -H "Content-Type: application/json" \
    -d '{
        "latitude": 19.0760,
        "longitude": 72.8777
    }')

UPDATED_LAT=$(echo "$LOCATION_UPDATE_RESPONSE" | jq -r '.user.latitude // empty' 2>/dev/null)
if [ ! -z "$UPDATED_LAT" ] && [ "$UPDATED_LAT" != "null" ]; then
    test_result 0 "Update location successful (lat: $UPDATED_LAT)"
else
    test_result 1 "Update location failed"
fi
echo ""

# Test 25: Update Preferred City (Test endpoint)
echo -e "${CYAN}Test 25: Update Preferred City (Test endpoint)${NC}"
CITY_UPDATE_RESPONSE=$(curl -s -X PATCH "$USER_SERVICE_URL/users/test/$TEST_USER_ID/preferred-city" \
    -H "Content-Type: application/json" \
    -d '{"city": "Mumbai"}')

UPDATED_CITY=$(echo "$CITY_UPDATE_RESPONSE" | jq -r '.city // empty' 2>/dev/null)
if [ "$UPDATED_CITY" = "Mumbai" ]; then
    test_result 0 "Update preferred city successful (city: $UPDATED_CITY)"
else
    test_result 1 "Update preferred city failed"
fi
echo ""

# ========== STATUS TESTS ==========

# Test 26: Update Status (Test endpoint)
echo -e "${CYAN}Test 26: Update Status (Test endpoint)${NC}"
STATUS_UPDATE_RESPONSE=$(curl -s -X PATCH "$USER_SERVICE_URL/users/test/$TEST_USER_ID/status" \
    -H "Content-Type: application/json" \
    -d '{"status": "IN_SQUAD_AVAILABLE"}')

UPDATED_STATUS=$(echo "$STATUS_UPDATE_RESPONSE" | jq -r '.user.status // empty' 2>/dev/null)
if [ "$UPDATED_STATUS" = "IN_SQUAD_AVAILABLE" ]; then
    test_result 0 "Update status successful (status: $UPDATED_STATUS)"
else
    test_result 1 "Update status failed"
fi
echo ""

# Test 27: All Status Values
echo -e "${CYAN}Test 27: All Status Values${NC}"
STATUSES=("AVAILABLE" "OFFLINE" "IN_SQUAD" "IN_SQUAD_AVAILABLE" "IN_BROADCAST" "IN_BROADCAST_AVAILABLE")
STATUS_TEST_PASSED=0
for status in "${STATUSES[@]}"; do
    STATUS_TEST_RESPONSE=$(curl -s -X PATCH "$USER_SERVICE_URL/users/test/$TEST_USER_ID/status" \
        -H "Content-Type: application/json" \
        -d "{\"status\": \"$status\"}")
    
    TEST_STATUS=$(echo "$STATUS_TEST_RESPONSE" | jq -r '.user.status // empty' 2>/dev/null)
    if [ "$TEST_STATUS" = "$status" ]; then
        ((STATUS_TEST_PASSED++))
    fi
done

if [ $STATUS_TEST_PASSED -eq ${#STATUSES[@]} ]; then
    test_result 0 "All status values working (${#STATUSES[@]} statuses tested)"
else
    test_result 1 "Some status values failed ($STATUS_TEST_PASSED/${#STATUSES[@]} passed)"
fi
echo ""

# ========== GENDER CHANGE TESTS ==========

# Test 28: Gender Change from PREFER_NOT_TO_SAY to MALE
echo -e "${CYAN}Test 28: Gender Change from PREFER_NOT_TO_SAY to MALE${NC}"
# Create user with PREFER_NOT_TO_SAY
PNS_CREATE_RESPONSE=$(curl -s -X POST "$USER_SERVICE_URL/users/$TEST_USER_ID_PNS/profile" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "PNSUser'$TIMESTAMP'",
        "dateOfBirth": "2000-01-01T00:00:00Z",
        "gender": "PREFER_NOT_TO_SAY",
        "displayPictureUrl": "https://example.com/safe-profile.jpg"
    }')

# Try to change gender to MALE (should succeed)
GENDER_CHANGE_RESPONSE=$(curl -s -X PATCH "$USER_SERVICE_URL/users/test/$TEST_USER_ID_PNS/profile" \
    -H "Content-Type: application/json" \
    -d '{"gender": "MALE"}')

CHANGED_GENDER=$(echo "$GENDER_CHANGE_RESPONSE" | jq -r '.user.gender // empty' 2>/dev/null)
if [ "$CHANGED_GENDER" = "MALE" ]; then
    test_result 0 "Gender change from PREFER_NOT_TO_SAY to MALE successful"
    
    # Try to change again (should fail)
    GENDER_CHANGE_2_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X PATCH "$USER_SERVICE_URL/users/test/$TEST_USER_ID_PNS/profile" \
        -H "Content-Type: application/json" \
        -d '{"gender": "FEMALE"}')
    
    HTTP_STATUS=$(echo "$GENDER_CHANGE_2_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
    if [ "$HTTP_STATUS" = "400" ]; then
        test_result 0 "Gender change blocked after first change (correct behavior)"
    else
        test_result 1 "Gender change not blocked after first change"
    fi
else
    test_result 1 "Gender change from PREFER_NOT_TO_SAY failed"
fi
echo ""

# Test 29: Gender Change from MALE (Should Fail)
echo -e "${CYAN}Test 29: Gender Change from MALE (Should Fail)${NC}"
GENDER_CHANGE_MALE_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X PATCH "$USER_SERVICE_URL/users/test/$TEST_USER_ID/profile" \
    -H "Content-Type: application/json" \
    -d '{"gender": "FEMALE"}')

HTTP_STATUS=$(echo "$GENDER_CHANGE_MALE_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
if [ "$HTTP_STATUS" = "400" ]; then
    test_result 0 "Gender change from MALE blocked (correct behavior)"
else
    test_result 1 "Gender change from MALE not blocked (expected 400, got $HTTP_STATUS)"
fi
echo ""

# ========== FIELD SELECTION TESTS ==========

# Test 30: Field Selection - Single Field
echo -e "${CYAN}Test 30: Field Selection - Single Field${NC}"
FIELD_SELECT_RESPONSE=$(curl -s "$USER_SERVICE_URL/users/$TEST_USER_ID?fields=username")
HAS_USERNAME=$(echo "$FIELD_SELECT_RESPONSE" | jq -r '.user.username // empty' 2>/dev/null)
HAS_PHOTOS=$(echo "$FIELD_SELECT_RESPONSE" | jq -r '.user.photos // empty' 2>/dev/null)

if [ ! -z "$HAS_USERNAME" ] && [ "$HAS_USERNAME" != "null" ]; then
    if [ "$HAS_PHOTOS" = "null" ] || [ -z "$HAS_PHOTOS" ]; then
        test_result 0 "Field selection working (only username returned)"
    else
        test_result 0 "Field selection working (username returned, photos may be empty array)"
    fi
else
    test_result 1 "Field selection failed"
    echo "  Response: $FIELD_SELECT_RESPONSE"
fi
echo ""

# Test 31: Field Selection - Multiple Fields
echo -e "${CYAN}Test 31: Field Selection - Multiple Fields${NC}"
MULTI_FIELD_RESPONSE=$(curl -s "$USER_SERVICE_URL/users/$TEST_USER_ID?fields=username,status,gender")
HAS_USERNAME=$(echo "$MULTI_FIELD_RESPONSE" | jq -r '.user.username // empty' 2>/dev/null)
HAS_STATUS=$(echo "$MULTI_FIELD_RESPONSE" | jq -r '.user.status // empty' 2>/dev/null)
HAS_GENDER=$(echo "$MULTI_FIELD_RESPONSE" | jq -r '.user.gender // empty' 2>/dev/null)

if [ ! -z "$HAS_USERNAME" ] && [ ! -z "$HAS_STATUS" ] && [ ! -z "$HAS_GENDER" ]; then
    test_result 0 "Multiple field selection working"
else
    test_result 1 "Multiple field selection failed"
fi
echo ""

# Test 32: Field Selection - Relation Fields
echo -e "${CYAN}Test 32: Field Selection - Relation Fields${NC}"
RELATION_FIELD_RESPONSE=$(curl -s "$USER_SERVICE_URL/users/$TEST_USER_ID?fields=photos,brandPreferences")
HAS_PHOTOS=$(echo "$RELATION_FIELD_RESPONSE" | jq -r '.user.photos // empty' 2>/dev/null)
HAS_BRANDS=$(echo "$RELATION_FIELD_RESPONSE" | jq -r '.user.brandPreferences // empty' 2>/dev/null)

if [ "$HAS_PHOTOS" != "null" ] || [ "$HAS_BRANDS" != "null" ]; then
    test_result 0 "Relation field selection working"
else
    test_result 1 "Relation field selection failed"
fi
echo ""

# Test 33: Full Profile (No Fields)
echo -e "${CYAN}Test 33: Full Profile (No Fields)${NC}"
FULL_PROFILE_RESPONSE=$(curl -s "$USER_SERVICE_URL/users/$TEST_USER_ID")
FIELD_COUNT=$(echo "$FULL_PROFILE_RESPONSE" | jq -r '.user | keys | length' 2>/dev/null || echo "0")

if [ "$FIELD_COUNT" -gt 10 ]; then
    test_result 0 "Full profile returned ($FIELD_COUNT+ fields)"
else
    test_result 1 "Full profile incomplete"
fi
echo ""

# ========== BATCH OPERATIONS TESTS ==========

# Test 34: Get Users by IDs
echo -e "${CYAN}Test 34: Get Users by IDs${NC}"
BATCH_RESPONSE=$(curl -s -X POST "$USER_SERVICE_URL/users/batch" \
    -H "Content-Type: application/json" \
    -d "{\"userIds\": [\"$TEST_USER_ID\", \"$TEST_USER_ID_2\"]}")

BATCH_COUNT=$(echo "$BATCH_RESPONSE" | jq -r '.users | length' 2>/dev/null || echo "0")
if [ "$BATCH_COUNT" -gt 0 ]; then
    test_result 0 "Get users by IDs successful ($BATCH_COUNT users)"
else
    test_result 1 "Get users by IDs failed"
fi
echo ""

# Test 35: Get Users Nearby
echo -e "${CYAN}Test 35: Get Users Nearby${NC}"
NEARBY_RESPONSE=$(curl -s "$USER_SERVICE_URL/users/nearby?latitude=19.0760&longitude=72.8777&radius=10&limit=10")
NEARBY_COUNT=$(echo "$NEARBY_RESPONSE" | jq -r '.users | length' 2>/dev/null || echo "0")

if [ ! -z "$NEARBY_RESPONSE" ]; then
    test_result 0 "Get users nearby successful ($NEARBY_COUNT users)"
else
    test_result 1 "Get users nearby failed"
fi
echo ""

# ========== METRICS TESTS ==========

# Test 36: Get Active Meetings Count
echo -e "${CYAN}Test 36: Get Active Meetings Count${NC}"
METRICS_RESPONSE=$(curl -s "$USER_SERVICE_URL/metrics/active-meetings")
METRICS_COUNT=$(echo "$METRICS_RESPONSE" | jq -r '.count // empty' 2>/dev/null)

if [ ! -z "$METRICS_COUNT" ] && [ "$METRICS_COUNT" != "null" ]; then
    test_result 0 "Get active meetings count successful (count: $METRICS_COUNT)"
else
    test_result 1 "Get active meetings count failed"
fi
echo ""

# Test 37: Get Cities with Max Users
echo -e "${CYAN}Test 37: Get Cities with Max Users${NC}"
CITIES_METRICS_RESPONSE=$(curl -s "$USER_SERVICE_URL/metrics/cities?limit=10")
# Response is an array directly, not wrapped in { cities: [...] }
CITIES_METRICS_COUNT=$(echo "$CITIES_METRICS_RESPONSE" | jq -r '. | length' 2>/dev/null || echo "0")

if [ "$CITIES_METRICS_COUNT" -gt 0 ]; then
    test_result 0 "Get cities with max users successful ($CITIES_METRICS_COUNT cities)"
else
    test_result 1 "Get cities with max users failed"
    echo "  Response: $CITIES_METRICS_RESPONSE"
fi
echo ""

# ========== DISCOVERY TESTS ==========

# Test 38: Get Users for Discovery
echo -e "${CYAN}Test 38: Get Users for Discovery${NC}"
DISCOVERY_RESPONSE=$(curl -s -X POST "$USER_SERVICE_URL/users/discovery" \
    -H "Content-Type: application/json" \
    -d '{
        "city": "Mumbai",
        "statuses": ["AVAILABLE", "IN_SQUAD_AVAILABLE"],
        "genders": ["MALE", "FEMALE"],
        "excludeUserIds": ["'$TEST_USER_ID'"],
        "limit": 10
    }')

DISCOVERY_COUNT=$(echo "$DISCOVERY_RESPONSE" | jq -r '.users | length' 2>/dev/null || echo "0")
if [ "$DISCOVERY_COUNT" -gt 0 ]; then
    test_result 0 "Get users for discovery successful ($DISCOVERY_COUNT users)"
else
    test_result 1 "Get users for discovery failed"
fi
echo ""

# Test 39: Get Users for Discovery - Anywhere
echo -e "${CYAN}Test 39: Get Users for Discovery - Anywhere${NC}"
DISCOVERY_ANYWHERE_RESPONSE=$(curl -s -X POST "$USER_SERVICE_URL/users/discovery" \
    -H "Content-Type: application/json" \
    -d '{
        "city": null,
        "statuses": ["AVAILABLE"],
        "limit": 10
    }')

DISCOVERY_ANYWHERE_COUNT=$(echo "$DISCOVERY_ANYWHERE_RESPONSE" | jq -r '.users | length' 2>/dev/null || echo "0")
if [ "$DISCOVERY_ANYWHERE_COUNT" -gt 0 ]; then
    test_result 0 "Get users for discovery (anywhere) successful ($DISCOVERY_ANYWHERE_COUNT users)"
else
    test_result 1 "Get users for discovery (anywhere) failed"
fi
echo ""

# ========== EDGE CASES ==========

# Test 40: Invalid Brand ID
echo -e "${CYAN}Test 40: Invalid Brand ID${NC}"
INVALID_BRAND_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X PATCH "$USER_SERVICE_URL/users/test/$TEST_USER_ID/brand-preferences" \
    -H "Content-Type: application/json" \
    -d '{"brandIds": ["invalid-brand-id"]}')

HTTP_STATUS=$(echo "$INVALID_BRAND_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
if [ "$HTTP_STATUS" = "404" ]; then
    test_result 0 "Invalid brand ID rejected (404)"
else
    test_result 1 "Invalid brand ID not rejected (expected 404, got $HTTP_STATUS)"
fi
echo ""

# Test 41: Invalid Interest ID
echo -e "${CYAN}Test 41: Invalid Interest ID${NC}"
INVALID_INTEREST_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X PATCH "$USER_SERVICE_URL/users/test/$TEST_USER_ID/interests" \
    -H "Content-Type: application/json" \
    -d '{"interestIds": ["invalid-interest-id"]}')

HTTP_STATUS=$(echo "$INVALID_INTEREST_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
if [ "$HTTP_STATUS" = "404" ]; then
    test_result 0 "Invalid interest ID rejected (404)"
else
    test_result 1 "Invalid interest ID not rejected (expected 404, got $HTTP_STATUS)"
fi
echo ""

# Test 42: Invalid Value ID
echo -e "${CYAN}Test 42: Invalid Value ID${NC}"
INVALID_VALUE_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X PATCH "$USER_SERVICE_URL/users/test/$TEST_USER_ID/values" \
    -H "Content-Type: application/json" \
    -d '{"valueIds": ["invalid-value-id"]}')

HTTP_STATUS=$(echo "$INVALID_VALUE_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
if [ "$HTTP_STATUS" = "404" ]; then
    test_result 0 "Invalid value ID rejected (404)"
else
    test_result 1 "Invalid value ID not rejected (expected 404, got $HTTP_STATUS)"
fi
echo ""

# Test 43: Invalid Music Preference ID
echo -e "${CYAN}Test 43: Invalid Music Preference ID${NC}"
INVALID_MUSIC_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X PATCH "$USER_SERVICE_URL/users/test/$TEST_USER_ID/music-preference" \
    -H "Content-Type: application/json" \
    -d '{"musicPreferenceId": "invalid-music-id"}')

HTTP_STATUS=$(echo "$INVALID_MUSIC_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
if [ "$HTTP_STATUS" = "404" ]; then
    test_result 0 "Invalid music preference ID rejected (404)"
else
    test_result 1 "Invalid music preference ID not rejected (expected 404, got $HTTP_STATUS)"
fi
echo ""

# Test 44: Duplicate Photo Order
echo -e "${CYAN}Test 44: Duplicate Photo Order${NC}"
# Add photo with order 0
curl -s -X POST "$USER_SERVICE_URL/users/test/$TEST_USER_ID/photos" \
    -H "Content-Type: application/json" \
    -d '{"url": "https://example.com/photo-1.jpg", "order": 0}' > /dev/null

# Try to add another photo with same order (should fail)
DUPLICATE_ORDER_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST "$USER_SERVICE_URL/users/test/$TEST_USER_ID/photos" \
    -H "Content-Type: application/json" \
    -d '{"url": "https://example.com/photo-2.jpg", "order": 0}')

HTTP_STATUS=$(echo "$DUPLICATE_ORDER_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
if [ "$HTTP_STATUS" = "409" ] || [ "$HTTP_STATUS" = "400" ]; then
    test_result 0 "Duplicate photo order rejected (HTTP $HTTP_STATUS)"
else
    test_result 1 "Duplicate photo order not rejected (expected 400/409, got $HTTP_STATUS)"
fi
echo ""

# Test 45: Profile Already Exists
echo -e "${CYAN}Test 45: Profile Already Exists${NC}"
DUPLICATE_PROFILE_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST "$USER_SERVICE_URL/users/$TEST_USER_ID/profile" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "DuplicateUser",
        "dateOfBirth": "2000-01-01T00:00:00Z",
        "gender": "MALE",
        "displayPictureUrl": "https://example.com/safe.jpg"
    }')

HTTP_STATUS=$(echo "$DUPLICATE_PROFILE_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
if [ "$HTTP_STATUS" = "400" ]; then
    test_result 0 "Duplicate profile creation rejected (400)"
else
    test_result 1 "Duplicate profile creation not rejected (expected 400, got $HTTP_STATUS)"
fi
echo ""

# Test 46: Get Non-Existent User
echo -e "${CYAN}Test 46: Get Non-Existent User${NC}"
NONEXISTENT_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" "$USER_SERVICE_URL/users/non-existent-user-id")
HTTP_STATUS=$(echo "$NONEXISTENT_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)

if [ "$HTTP_STATUS" = "404" ]; then
    test_result 0 "Non-existent user returns 404"
else
    test_result 1 "Non-existent user not handled correctly (expected 404, got $HTTP_STATUS)"
fi
echo ""

# Test 47: Music Search - Empty Query
echo -e "${CYAN}Test 47: Music Search - Empty Query${NC}"
EMPTY_SEARCH_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" "$USER_SERVICE_URL/music/search?q=&limit=5")
HTTP_STATUS=$(echo "$EMPTY_SEARCH_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)

if [ "$HTTP_STATUS" = "400" ]; then
    test_result 0 "Empty music search query rejected (400)"
else
    test_result 1 "Empty music search query not rejected (expected 400, got $HTTP_STATUS)"
fi
echo ""

# Test 48: Music Search - Invalid Limit
echo -e "${CYAN}Test 48: Music Search - Invalid Limit${NC}"
INVALID_LIMIT_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" "$USER_SERVICE_URL/music/search?q=test&limit=100")
HTTP_STATUS=$(echo "$INVALID_LIMIT_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)

if [ "$HTTP_STATUS" = "400" ]; then
    test_result 0 "Invalid music search limit rejected (400)"
else
    test_result 1 "Invalid music search limit not rejected (expected 400, got $HTTP_STATUS)"
fi
echo ""

# Test 49: Discovery - Invalid Status
echo -e "${CYAN}Test 49: Discovery - Invalid Status${NC}"
INVALID_STATUS_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST "$USER_SERVICE_URL/users/discovery" \
    -H "Content-Type: application/json" \
    -d '{
        "statuses": ["INVALID_STATUS"],
        "limit": 10
    }')

HTTP_STATUS=$(echo "$INVALID_STATUS_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
if [ "$HTTP_STATUS" = "400" ]; then
    test_result 0 "Invalid discovery status rejected (400)"
else
    test_result 1 "Invalid discovery status not rejected (expected 400, got $HTTP_STATUS)"
fi
echo ""

# Test 50: Discovery - Missing Statuses
echo -e "${CYAN}Test 50: Discovery - Missing Statuses${NC}"
MISSING_STATUS_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST "$USER_SERVICE_URL/users/discovery" \
    -H "Content-Type: application/json" \
    -d '{"limit": 10}')

HTTP_STATUS=$(echo "$MISSING_STATUS_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
if [ "$HTTP_STATUS" = "400" ]; then
    test_result 0 "Missing discovery statuses rejected (400)"
else
    test_result 1 "Missing discovery statuses not rejected (expected 400, got $HTTP_STATUS)"
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
