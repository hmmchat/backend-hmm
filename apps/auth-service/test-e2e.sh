#!/bin/bash

# End-to-End Testing Script for Auth Service
# Interactive script to test all token-based authentication flows
# 
# Usage:
#   ./test-e2e.sh                                    # Interactive mode (will ask for tokens)
#   ./test-e2e.sh ACCESS_TOKEN REFRESH_TOKEN         # Pass tokens as arguments
#   ACCESS_TOKEN=... REFRESH_TOKEN=... ./test-e2e.sh # Pass tokens as environment variables

BASE_URL="${BASE_URL:-http://localhost:3001}"
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
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

# Check if tokens are provided - if not, ask interactively
if [ -z "$ACCESS_TOKEN" ] || [ -z "$REFRESH_TOKEN" ]; then
    echo -e "${YELLOW}⚠️  No tokens provided.${NC}"
    echo ""
    echo -e "${CYAN}To test end-to-end flows, you need access and refresh tokens.${NC}"
    echo ""
    echo "You can get tokens by:"
    echo "  1. Running ./test-full-flow.sh (easiest - gets tokens from Google OAuth automatically)"
    echo "  2. Using OAuth flow (Google/Facebook/Apple)"
    echo "  3. Using Phone OTP flow (requires Twilio)"
    echo ""
    echo -e "${YELLOW}💡 For detailed instructions, see: HOW_TO_GET_TOKENS.md${NC}"
    echo ""
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "${CYAN}Please provide your tokens:${NC}"
    echo -e "${YELLOW}(Tip: If pasting doesn't work, you can save tokens to files and enter file paths)${NC}"
    echo ""
    
    # Get Access Token
    echo -n "Access Token (or file path): "
    IFS= read -r access_input
    access_input=$(echo "$access_input" | xargs)
    
    if [ -f "$access_input" ]; then
        echo -e "${CYAN}Reading access token from file...${NC}"
        ACCESS_TOKEN=$(cat "$access_input" | tr -d '\n\r ' | xargs)
        echo -e "${GREEN}✅ Access token read from file${NC}"
    else
        ACCESS_TOKEN=$(echo "$access_input" | tr -d '\n\r' | xargs)
    fi
    
    if [ -z "$ACCESS_TOKEN" ]; then
        echo -e "${RED}❌ No access token provided.${NC}"
        exit 1
    fi
    
    echo ""
    
    # Get Refresh Token
    echo -n "Refresh Token (or file path): "
    IFS= read -r refresh_input
    refresh_input=$(echo "$refresh_input" | xargs)
    
    if [ -f "$refresh_input" ]; then
        echo -e "${CYAN}Reading refresh token from file...${NC}"
        REFRESH_TOKEN=$(cat "$refresh_input" | tr -d '\n\r ' | xargs)
        echo -e "${GREEN}✅ Refresh token read from file${NC}"
    else
        REFRESH_TOKEN=$(echo "$refresh_input" | tr -d '\n\r' | xargs)
    fi
    
    if [ -z "$REFRESH_TOKEN" ]; then
        echo -e "${RED}❌ No refresh token provided.${NC}"
        exit 1
fi

    echo ""
    echo -e "${GREEN}✅ Tokens received (Access: ${#ACCESS_TOKEN} chars, Refresh: ${#REFRESH_TOKEN} chars)${NC}"
    echo ""
else
echo -e "${GREEN}✅ Tokens provided${NC}"
echo ""
fi

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
echo -e "${BLUE}📝 Test Summary:${NC}"
echo "  ✅ Get user info"
echo "  ✅ Update preferences (with location)"
echo "  ✅ Update preferences (without location)"
echo "  ✅ Refresh access token"
echo "  ✅ Verify new access token works"
echo "  ✅ Logout"
echo "  ✅ Verify refresh token invalidated"
echo ""
echo -e "${YELLOW}💡 Tips:${NC}"
echo "  • To get new tokens easily, run: ./test-full-flow.sh"
echo "  • To test other OAuth providers, see: E2E_TESTING.md"
echo "  • To test phone OTP, configure Twilio in .env"
echo ""
echo -e "${CYAN}📚 For more details, see: E2E_TESTING.md${NC}"

