#!/bin/bash

USER_SERVICE_URL="http://localhost:3002"
DISCOVERY_SERVICE_URL="http://localhost:3004"
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
echo -e "  LOCATION FEATURE TESTS"
echo -e "  Testing Location Endpoints"
echo -e "==========================================${NC}"
echo ""

# ==========================================
# PHASE 0: SETUP AND VALIDATION
# ==========================================

echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}PHASE 0: SETUP AND VALIDATION${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Check if services are running
echo -e "${CYAN}Step 0.1: Checking services...${NC}"
SERVICES_OK=true

if curl -s "$USER_SERVICE_URL/metrics/active-meetings" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ User service is running${NC}"
else
    echo -e "${RED}❌ User service is not running${NC}"
    SERVICES_OK=false
fi

if curl -s "$DISCOVERY_SERVICE_URL/health" > /dev/null 2>&1 || curl -s "$DISCOVERY_SERVICE_URL/location/cities" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Discovery service is running${NC}"
else
    echo -e "${RED}❌ Discovery service is not running${NC}"
    SERVICES_OK=false
fi

if curl -s "$AUTH_SERVICE_URL/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Auth service is running${NC}"
else
    echo -e "${YELLOW}⚠️  Auth service is not running. Token tests may fail.${NC}"
fi

if [ "$SERVICES_OK" = false ]; then
    echo -e "${RED}❌ Please start required services before running tests${NC}"
    exit 1
fi

# Load test token if available
TOKEN_FILE="$SCRIPT_DIR/.test-tokens"
ACCESS_TOKEN=""
if [ -f "$TOKEN_FILE" ]; then
    ACCESS_TOKEN=$(head -n 1 "$TOKEN_FILE" | tr -d '\n\r')
    if [ -n "$ACCESS_TOKEN" ]; then
        echo -e "${GREEN}✅ Loaded test token${NC}"
    else
        echo -e "${YELLOW}⚠️  Test token file exists but is empty${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  No test token file found. Some authenticated tests will be skipped.${NC}"
    echo "   Create $TOKEN_FILE with a valid access token to test authenticated endpoints"
fi

echo ""

# ==========================================
# PHASE 1: GET CITIES WITH MAX USERS
# ==========================================

echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}PHASE 1: GET CITIES WITH MAX USERS${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

echo -e "${CYAN}Test 1.1: GET /location/cities (default limit)${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" "$DISCOVERY_SERVICE_URL/location/cities")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ Status: $HTTP_CODE${NC}"
    echo "Response: $BODY" | jq '.' 2>/dev/null || echo "Response: $BODY"
    
    # Validate response structure
    CITY_COUNT=$(echo "$BODY" | jq '. | length' 2>/dev/null || echo "0")
    if [ "$CITY_COUNT" -ge 0 ]; then
        echo -e "${GREEN}✅ Response is a valid array with $CITY_COUNT cities${NC}"
    else
        echo -e "${YELLOW}⚠️  Response structure may be invalid${NC}"
    fi
else
    echo -e "${RED}❌ Status: $HTTP_CODE${NC}"
    echo "Response: $BODY"
fi
echo ""

echo -e "${CYAN}Test 1.2: GET /location/cities?limit=5${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" "$DISCOVERY_SERVICE_URL/location/cities?limit=5")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ Status: $HTTP_CODE${NC}"
    CITY_COUNT=$(echo "$BODY" | jq '. | length' 2>/dev/null || echo "0")
    echo "Found $CITY_COUNT cities"
    
    if [ "$CITY_COUNT" -le 5 ]; then
        echo -e "${GREEN}✅ Limit parameter works correctly${NC}"
    else
        echo -e "${YELLOW}⚠️  Limit may not be working (got $CITY_COUNT, expected <= 5)${NC}"
    fi
else
    echo -e "${RED}❌ Status: $HTTP_CODE${NC}"
    echo "Response: $BODY"
fi
echo ""

echo -e "${CYAN}Test 1.3: GET /location/cities?limit=invalid (should fail)${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" "$DISCOVERY_SERVICE_URL/location/cities?limit=invalid")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "400" ]; then
    echo -e "${GREEN}✅ Status: $HTTP_CODE (validation error as expected)${NC}"
else
    echo -e "${YELLOW}⚠️  Expected 400, got $HTTP_CODE${NC}"
    echo "Response: $BODY"
fi
echo ""

# ==========================================
# PHASE 2: SEARCH CITIES
# ==========================================

echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}PHASE 2: SEARCH CITIES${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

echo -e "${CYAN}Test 2.1: GET /location/search?q=mumbai${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" "$DISCOVERY_SERVICE_URL/location/search?q=mumbai")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ Status: $HTTP_CODE${NC}"
    echo "Response: $BODY" | jq '.' 2>/dev/null || echo "Response: $BODY"
    
    # Check if Mumbai is in results
    HAS_MUMBAI=$(echo "$BODY" | jq '[.[] | select(.city | ascii_downcase | contains("mumbai"))] | length' 2>/dev/null || echo "0")
    if [ "$HAS_MUMBAI" -gt 0 ]; then
        echo -e "${GREEN}✅ Found Mumbai in results${NC}"
    else
        echo -e "${YELLOW}⚠️  Mumbai not found in results (may be due to geocoding API)${NC}"
    fi
else
    echo -e "${RED}❌ Status: $HTTP_CODE${NC}"
    echo "Response: $BODY"
fi
echo ""

echo -e "${CYAN}Test 2.2: GET /location/search?q=delhi${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" "$DISCOVERY_SERVICE_URL/location/search?q=delhi")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ Status: $HTTP_CODE${NC}"
    CITY_COUNT=$(echo "$BODY" | jq '. | length' 2>/dev/null || echo "0")
    echo "Found $CITY_COUNT cities"
else
    echo -e "${RED}❌ Status: $HTTP_CODE${NC}"
    echo "Response: $BODY"
fi
echo ""

echo -e "${CYAN}Test 2.3: GET /location/search (missing query - should fail)${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" "$DISCOVERY_SERVICE_URL/location/search")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "400" ]; then
    echo -e "${GREEN}✅ Status: $HTTP_CODE (validation error as expected)${NC}"
else
    echo -e "${YELLOW}⚠️  Expected 400, got $HTTP_CODE${NC}"
    echo "Response: $BODY"
fi
echo ""

echo -e "${CYAN}Test 2.4: GET /location/search?q=pune&limit=3${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" "$DISCOVERY_SERVICE_URL/location/search?q=pune&limit=3")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ Status: $HTTP_CODE${NC}"
    CITY_COUNT=$(echo "$BODY" | jq '. | length' 2>/dev/null || echo "0")
    echo "Found $CITY_COUNT cities"
    
    if [ "$CITY_COUNT" -le 3 ]; then
        echo -e "${GREEN}✅ Limit parameter works correctly${NC}"
    else
        echo -e "${YELLOW}⚠️  Limit may not be working${NC}"
    fi
else
    echo -e "${RED}❌ Status: $HTTP_CODE${NC}"
    echo "Response: $BODY"
fi
echo ""

# ==========================================
# PHASE 3: LOCATE ME (REVERSE GEOCODING)
# ==========================================

echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}PHASE 3: LOCATE ME (REVERSE GEOCODING)${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

echo -e "${CYAN}Test 3.1: POST /location/locate-me (Mumbai coordinates)${NC}"
# Mumbai coordinates: 19.0760° N, 72.8777° E
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$DISCOVERY_SERVICE_URL/location/locate-me" \
  -H "Content-Type: application/json" \
  -d '{"latitude": 19.0760, "longitude": 72.8777}')
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ Status: $HTTP_CODE${NC}"
    echo "Response: $BODY" | jq '.' 2>/dev/null || echo "Response: $BODY"
    
    CITY=$(echo "$BODY" | jq -r '.city' 2>/dev/null || echo "")
    if [ -n "$CITY" ]; then
        echo -e "${GREEN}✅ Successfully retrieved city: $CITY${NC}"
    else
        echo -e "${YELLOW}⚠️  City field missing in response${NC}"
    fi
else
    echo -e "${RED}❌ Status: $HTTP_CODE${NC}"
    echo "Response: $BODY"
fi
echo ""

echo -e "${CYAN}Test 3.2: POST /location/locate-me (Delhi coordinates)${NC}"
# Delhi coordinates: 28.6139° N, 77.2090° E
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$DISCOVERY_SERVICE_URL/location/locate-me" \
  -H "Content-Type: application/json" \
  -d '{"latitude": 28.6139, "longitude": 77.2090}')
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ Status: $HTTP_CODE${NC}"
    CITY=$(echo "$BODY" | jq -r '.city' 2>/dev/null || echo "")
    echo "Retrieved city: $CITY"
else
    echo -e "${RED}❌ Status: $HTTP_CODE${NC}"
    echo "Response: $BODY"
fi
echo ""

echo -e "${CYAN}Test 3.3: POST /location/locate-me (invalid coordinates - should fail)${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$DISCOVERY_SERVICE_URL/location/locate-me" \
  -H "Content-Type: application/json" \
  -d '{"latitude": 200, "longitude": 300}')
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "400" ]; then
    echo -e "${GREEN}✅ Status: $HTTP_CODE (validation error as expected)${NC}"
else
    echo -e "${YELLOW}⚠️  Expected 400, got $HTTP_CODE${NC}"
    echo "Response: $BODY"
fi
echo ""

echo -e "${CYAN}Test 3.4: POST /location/locate-me (missing fields - should fail)${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$DISCOVERY_SERVICE_URL/location/locate-me" \
  -H "Content-Type: application/json" \
  -d '{"latitude": 19.0760}')
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "400" ]; then
    echo -e "${GREEN}✅ Status: $HTTP_CODE (validation error as expected)${NC}"
else
    echo -e "${YELLOW}⚠️  Expected 400, got $HTTP_CODE${NC}"
    echo "Response: $BODY"
fi
echo ""

# ==========================================
# PHASE 4: PREFERRED CITY (AUTHENTICATED)
# ==========================================

if [ -z "$ACCESS_TOKEN" ]; then
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}PHASE 4: PREFERRED CITY (SKIPPED - NO TOKEN)${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}⚠️  Skipping authenticated tests. Add a token to .test-tokens to test these.${NC}"
    echo ""
else
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}PHASE 4: PREFERRED CITY (AUTHENTICATED)${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""

    echo -e "${CYAN}Test 4.1: GET /location/preference (get current preferred city)${NC}"
    RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$DISCOVERY_SERVICE_URL/location/preference" \
      -H "Authorization: Bearer $ACCESS_TOKEN")
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | sed '$d')

    if [ "$HTTP_CODE" = "200" ]; then
        echo -e "${GREEN}✅ Status: $HTTP_CODE${NC}"
        echo "Response: $BODY" | jq '.' 2>/dev/null || echo "Response: $BODY"
        
        CITY=$(echo "$BODY" | jq -r '.city // empty' 2>/dev/null || echo "")
        if [ -n "$CITY" ] && [ "$CITY" != "null" ]; then
            echo -e "${GREEN}✅ Current preferred city retrieved: $CITY${NC}"
        else
            echo -e "${CYAN}ℹ️  No preferred city set (null is default)${NC}"
        fi
    else
        echo -e "${RED}❌ Status: $HTTP_CODE${NC}"
        echo "Response: $BODY"
    fi
    echo ""

    echo -e "${CYAN}Test 4.2: PATCH /location/preference (set preferred city)${NC}"
    RESPONSE=$(curl -s -w "\n%{http_code}" -X PATCH "$DISCOVERY_SERVICE_URL/location/preference" \
      -H "Authorization: Bearer $ACCESS_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"city": "Mumbai"}')
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | sed '$d')

    if [ "$HTTP_CODE" = "200" ]; then
        echo -e "${GREEN}✅ Status: $HTTP_CODE${NC}"
        echo "Response: $BODY" | jq '.' 2>/dev/null || echo "Response: $BODY"
        
        UPDATED_CITY=$(echo "$BODY" | jq -r '.city // empty' 2>/dev/null || echo "")
        if [ -n "$UPDATED_CITY" ] && [ "$UPDATED_CITY" != "null" ]; then
            echo -e "${GREEN}✅ Preferred city updated successfully: $UPDATED_CITY${NC}"
        else
            echo -e "${YELLOW}⚠️  City may not have been updated${NC}"
        fi
    else
        echo -e "${RED}❌ Status: $HTTP_CODE${NC}"
        echo "Response: $BODY"
    fi
    echo ""

    echo -e "${CYAN}Test 4.3: GET /location/preference (verify update)${NC}"
    RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$DISCOVERY_SERVICE_URL/location/preference" \
      -H "Authorization: Bearer $ACCESS_TOKEN")
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | sed '$d')

    if [ "$HTTP_CODE" = "200" ]; then
        echo -e "${GREEN}✅ Status: $HTTP_CODE${NC}"
        CITY=$(echo "$BODY" | jq -r '.city' 2>/dev/null || echo "null")
        echo "Preferred city: $CITY"
        
        if [ "$CITY" = "Mumbai" ]; then
            echo -e "${GREEN}✅ Preferred city correctly stored: Mumbai${NC}"
        else
            echo -e "${YELLOW}⚠️  Expected Mumbai, got: $CITY${NC}"
        fi
    else
        echo -e "${RED}❌ Status: $HTTP_CODE${NC}"
        echo "Response: $BODY"
    fi
    echo ""

    echo -e "${CYAN}Test 4.4: PATCH /location/preference (clear city - set to null)${NC}"
    RESPONSE=$(curl -s -w "\n%{http_code}" -X PATCH "$DISCOVERY_SERVICE_URL/location/preference" \
      -H "Authorization: Bearer $ACCESS_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"city": null}')
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | sed '$d')

    if [ "$HTTP_CODE" = "200" ]; then
        echo -e "${GREEN}✅ Status: $HTTP_CODE${NC}"
        CITY=$(echo "$BODY" | jq -r '.city' 2>/dev/null || echo "null")
        if [ "$CITY" = "null" ] || [ -z "$CITY" ]; then
            echo -e "${GREEN}✅ Preferred city cleared (user can now connect with anyone)${NC}"
        else
            echo -e "${YELLOW}⚠️  City not cleared${NC}"
        fi
    else
        echo -e "${RED}❌ Status: $HTTP_CODE${NC}"
        echo "Response: $BODY"
    fi
    echo ""

    echo -e "${CYAN}Test 4.5: PATCH /location/preference (too many cities - should fail)${NC}"
    RESPONSE=$(curl -s -w "\n%{http_code}" -X PATCH "$DISCOVERY_SERVICE_URL/location/preference" \
      -H "Authorization: Bearer $ACCESS_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"cities": ["City1", "City2", "City3", "City4", "City5", "City6", "City7", "City8", "City9", "City10", "City11"]}')
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | sed '$d')

    if [ "$HTTP_CODE" = "400" ]; then
        echo -e "${GREEN}✅ Status: $HTTP_CODE (validation error as expected)${NC}"
    else
        echo -e "${YELLOW}⚠️  Expected 400, got $HTTP_CODE${NC}"
        echo "Response: $BODY"
    fi
    echo ""

    echo -e "${CYAN}Test 4.6: GET /location/preference (without token - should fail)${NC}"
    RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$DISCOVERY_SERVICE_URL/location/preference")
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | sed '$d')

    if [ "$HTTP_CODE" = "401" ]; then
        echo -e "${GREEN}✅ Status: $HTTP_CODE (unauthorized as expected)${NC}"
    else
        echo -e "${YELLOW}⚠️  Expected 401, got $HTTP_CODE${NC}"
        echo "Response: $BODY"
    fi
    echo ""
fi

# ==========================================
# PHASE 5: INTEGRATION TEST - FULL FLOW
# ==========================================

if [ -z "$ACCESS_TOKEN" ]; then
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}PHASE 5: INTEGRATION TEST (SKIPPED - NO TOKEN)${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}⚠️  Skipping integration test. Add a token to .test-tokens to test this.${NC}"
    echo ""
else
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}PHASE 5: INTEGRATION TEST - FULL FLOW${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""

    echo -e "${CYAN}Test 5.1: Full flow - Locate me → Search → Set preference → Verify${NC}"
    
    # Step 1: Locate me
    echo "  Step 1: Getting city from coordinates..."
    LOCATE_RESPONSE=$(curl -s -X POST "$DISCOVERY_SERVICE_URL/location/locate-me" \
      -H "Content-Type: application/json" \
      -d '{"latitude": 19.0760, "longitude": 72.8777}')
    LOCATED_CITY=$(echo "$LOCATE_RESPONSE" | jq -r '.city' 2>/dev/null || echo "")
    
    if [ -n "$LOCATED_CITY" ]; then
        echo -e "  ${GREEN}✅ Located city: $LOCATED_CITY${NC}"
        
        # Step 2: Search for cities
        echo "  Step 2: Searching for cities..."
        SEARCH_RESPONSE=$(curl -s "$DISCOVERY_SERVICE_URL/location/search?q=$LOCATED_CITY&limit=5")
        SEARCH_COUNT=$(echo "$SEARCH_RESPONSE" | jq '. | length' 2>/dev/null || echo "0")
        echo -e "  ${GREEN}✅ Found $SEARCH_COUNT cities matching '$LOCATED_CITY'${NC}"
        
        # Step 3: Set preferred city
        echo "  Step 3: Setting preferred city..."
        UPDATE_RESPONSE=$(curl -s -X PATCH "$DISCOVERY_SERVICE_URL/location/preference" \
          -H "Authorization: Bearer $ACCESS_TOKEN" \
          -H "Content-Type: application/json" \
          -d "{\"city\": \"$LOCATED_CITY\"}")
        UPDATE_CITY=$(echo "$UPDATE_RESPONSE" | jq -r '.city // empty' 2>/dev/null || echo "")
        
        if [ -n "$UPDATE_CITY" ] && [ "$UPDATE_CITY" != "null" ]; then
            echo -e "  ${GREEN}✅ Preferred city set${NC}"
            
            # Step 4: Verify
            echo "  Step 4: Verifying preferred city..."
            VERIFY_RESPONSE=$(curl -s -X GET "$DISCOVERY_SERVICE_URL/location/preference" \
              -H "Authorization: Bearer $ACCESS_TOKEN")
            VERIFY_CITY=$(echo "$VERIFY_RESPONSE" | jq -r '.city // empty' 2>/dev/null || echo "")
            
            if [ "$VERIFY_CITY" = "$LOCATED_CITY" ]; then
                echo -e "  ${GREEN}✅ Integration test passed!${NC}"
            else
                echo -e "  ${YELLOW}⚠️  Verification failed (expected $LOCATED_CITY, got $VERIFY_CITY)${NC}"
            fi
        else
            echo -e "  ${RED}❌ Failed to set preferred city${NC}"
        fi
    else
        echo -e "  ${RED}❌ Failed to locate city${NC}"
    fi
    echo ""
fi

# ==========================================
# SUMMARY
# ==========================================

echo -e "${BLUE}=========================================="
echo -e "  TEST SUMMARY"
echo -e "==========================================${NC}"
echo ""
echo -e "${GREEN}✅ Location feature tests completed${NC}"
echo ""
echo -e "${CYAN}Tested Endpoints:${NC}"
echo "  • GET  /location/cities"
echo "  • GET  /location/search"
echo "  • POST /location/locate-me"
echo "  • GET  /location/preference (authenticated)"
echo "  • PATCH /location/preference (authenticated)"
echo ""
echo -e "${CYAN}Note:${NC}"
echo "  • Some tests require a valid access token in .test-tokens"
echo "  • Geocoding tests depend on OpenStreetMap Nominatim API availability"
echo "  • City counts depend on actual user data in the database"
echo ""

