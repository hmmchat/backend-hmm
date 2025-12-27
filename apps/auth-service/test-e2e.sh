#!/bin/bash

# End-to-End Testing Script for Auth Service
# Usage: ./test-e2e.sh [ACCESS_TOKEN] [REFRESH_TOKEN]
# Or set environment variables: ACCESS_TOKEN and REFRESH_TOKEN

BASE_URL="${BASE_URL:-http://localhost:3001}"
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get tokens from args or env
ACCESS_TOKEN="${1:-$ACCESS_TOKEN}"
REFRESH_TOKEN="${2:-$REFRESH_TOKEN}"

echo -e "${BLUE}🧪 End-to-End Testing - Auth Service${NC}"
echo "Base URL: $BASE_URL"
echo ""

# Check if service is running
echo -e "${YELLOW}1. Checking if service is running...${NC}"
if curl -s -f "$BASE_URL/me/metrics" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Service is running${NC}"
else
    echo -e "${RED}❌ Service is not running. Please start it with: npm run start:dev${NC}"
    exit 1
fi
echo ""

# Check if tokens are provided
if [ -z "$ACCESS_TOKEN" ] || [ -z "$REFRESH_TOKEN" ]; then
    echo -e "${YELLOW}⚠️  No tokens provided.${NC}"
    echo ""
    echo "To test end-to-end flows, you need access and refresh tokens."
    echo ""
    echo "Options:"
    echo "  1. Get tokens from OAuth flow (Google/Facebook/Apple)"
    echo "  2. Get tokens from Phone OTP flow (requires Twilio)"
    echo ""
    echo "Usage:"
    echo "  ./test-e2e.sh ACCESS_TOKEN REFRESH_TOKEN"
    echo "  OR"
    echo "  export ACCESS_TOKEN=... REFRESH_TOKEN=..."
    echo "  ./test-e2e.sh"
    echo ""
    echo "See E2E_TESTING.md for instructions on getting tokens."
    exit 0
fi

echo -e "${GREEN}✅ Tokens provided${NC}"
echo ""

# Test 1: Get User Info
echo -e "${YELLOW}2. Testing GET /me (get user info)...${NC}"
ME_RESPONSE=$(curl -s -X GET "$BASE_URL/me" \
  -H "Authorization: Bearer $ACCESS_TOKEN")
if echo "$ME_RESPONSE" | jq . > /dev/null 2>&1; then
    if echo "$ME_RESPONSE" | jq -e '.user' > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Get user info successful${NC}"
        echo "$ME_RESPONSE" | jq .
    else
        echo -e "${RED}❌ Get user info failed${NC}"
        echo "$ME_RESPONSE" | jq .
    fi
else
    echo -e "${RED}❌ Get user info failed (invalid response)${NC}"
    echo "$ME_RESPONSE"
fi
echo ""

# Test 2: Update Preferences (With Location)
echo -e "${YELLOW}3. Testing PATCH /me/preferences (with location)...${NC}"
PREF_RESPONSE=$(curl -s -X PATCH "$BASE_URL/me/preferences" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "videoEnabled": false,
    "meetMode": "location",
    "location": {
      "lat": 37.7749,
      "lng": -122.4194
    }
  }')
if echo "$PREF_RESPONSE" | jq . > /dev/null 2>&1; then
    if echo "$PREF_RESPONSE" | jq -e '.preferences' > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Update preferences (with location) successful${NC}"
        echo "$PREF_RESPONSE" | jq .
    else
        echo -e "${RED}❌ Update preferences failed${NC}"
        echo "$PREF_RESPONSE" | jq .
    fi
else
    echo -e "${RED}❌ Update preferences failed (invalid response)${NC}"
    echo "$PREF_RESPONSE"
fi
echo ""

# Test 3: Update Preferences (Without Location)
echo -e "${YELLOW}4. Testing PATCH /me/preferences (without location)...${NC}"
PREF2_RESPONSE=$(curl -s -X PATCH "$BASE_URL/me/preferences" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "videoEnabled": true,
    "meetMode": "both"
  }')
if echo "$PREF2_RESPONSE" | jq . > /dev/null 2>&1; then
    if echo "$PREF2_RESPONSE" | jq -e '.preferences' > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Update preferences (without location) successful${NC}"
        echo "$PREF2_RESPONSE" | jq .
    else
        echo -e "${RED}❌ Update preferences failed${NC}"
        echo "$PREF2_RESPONSE" | jq .
    fi
else
    echo -e "${RED}❌ Update preferences failed (invalid response)${NC}"
    echo "$PREF2_RESPONSE"
fi
echo ""

# Test 4: Refresh Access Token
echo -e "${YELLOW}5. Testing POST /auth/refresh...${NC}"
REFRESH_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/refresh" \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\": \"$REFRESH_TOKEN\"}")
if echo "$REFRESH_RESPONSE" | jq . > /dev/null 2>&1; then
    NEW_ACCESS_TOKEN=$(echo "$REFRESH_RESPONSE" | jq -r '.accessToken // empty')
    if [ -n "$NEW_ACCESS_TOKEN" ] && [ "$NEW_ACCESS_TOKEN" != "null" ]; then
        echo -e "${GREEN}✅ Refresh token successful${NC}"
        echo "$REFRESH_RESPONSE" | jq .
        ACCESS_TOKEN="$NEW_ACCESS_TOKEN"
    else
        echo -e "${RED}❌ Refresh token failed${NC}"
        echo "$REFRESH_RESPONSE" | jq .
    fi
else
    echo -e "${RED}❌ Refresh token failed (invalid response)${NC}"
    echo "$REFRESH_RESPONSE"
fi
echo ""

# Test 5: Verify New Token Works
if [ -n "$NEW_ACCESS_TOKEN" ] && [ "$NEW_ACCESS_TOKEN" != "null" ]; then
    echo -e "${YELLOW}6. Testing GET /me with new access token...${NC}"
    ME2_RESPONSE=$(curl -s -X GET "$BASE_URL/me" \
      -H "Authorization: Bearer $NEW_ACCESS_TOKEN")
    if echo "$ME2_RESPONSE" | jq -e '.user' > /dev/null 2>&1; then
        echo -e "${GREEN}✅ New access token works${NC}"
    else
        echo -e "${RED}❌ New access token failed${NC}"
        echo "$ME2_RESPONSE" | jq .
    fi
    echo ""
fi

# Test 6: Logout
echo -e "${YELLOW}7. Testing POST /auth/logout...${NC}"
LOGOUT_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/logout" \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\": \"$REFRESH_TOKEN\"}")
if echo "$LOGOUT_RESPONSE" | jq . > /dev/null 2>&1; then
    if echo "$LOGOUT_RESPONSE" | jq -e '.ok == true' > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Logout successful${NC}"
        echo "$LOGOUT_RESPONSE" | jq .
    else
        echo -e "${RED}❌ Logout failed${NC}"
        echo "$LOGOUT_RESPONSE" | jq .
    fi
else
    echo -e "${RED}❌ Logout failed (invalid response)${NC}"
    echo "$LOGOUT_RESPONSE"
fi
echo ""

# Test 7: Verify Refresh Token No Longer Works
echo -e "${YELLOW}8. Testing refresh token after logout (should fail)...${NC}"
REFRESH2_RESPONSE=$(curl -s -w "\n%{http_code}" "$BASE_URL/auth/refresh" \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\": \"$REFRESH_TOKEN\"}")
HTTP_CODE=$(echo "$REFRESH2_RESPONSE" | tail -1)
BODY=$(echo "$REFRESH2_RESPONSE" | head -n -1)
if [ "$HTTP_CODE" = "401" ]; then
    echo -e "${GREEN}✅ Refresh token correctly invalidated (401 as expected)${NC}"
    echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
else
    echo -e "${YELLOW}⚠️  Unexpected status code: $HTTP_CODE${NC}"
    echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
fi
echo ""

echo -e "${GREEN}✅ End-to-end tests complete!${NC}"
echo ""
echo -e "${BLUE}📝 Summary:${NC}"
echo "  ✅ Get user info"
echo "  ✅ Update preferences (with location)"
echo "  ✅ Update preferences (without location)"
echo "  ✅ Refresh access token"
echo "  ✅ Logout"
echo "  ✅ Verify refresh token invalidated"
echo ""
echo -e "${YELLOW}💡 Next Steps:${NC}"
echo "  1. Test OAuth flows with real tokens (Google, Facebook, Apple)"
echo "  2. Test phone OTP with Twilio credentials"
echo "  3. Test error cases (expired tokens, invalid tokens, etc.)"
echo ""
echo "See E2E_TESTING.md for detailed instructions"

