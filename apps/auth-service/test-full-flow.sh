#!/bin/bash

# Interactive script to test full authentication flow
# This guides you through getting a Google token and testing everything

BASE_URL="${BASE_URL:-http://localhost:3001}"
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Full Authentication Flow Testing${NC}"
echo ""

# Check if service is running
echo -e "${YELLOW}Step 1: Checking service...${NC}"
if curl -s -f "$BASE_URL/me/metrics" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Service is running${NC}"
else
    echo -e "${RED}❌ Service is not running. Please start it first:${NC}"
    echo "   cd apps/auth-service && npm run start:dev"
    exit 1
fi
echo ""

# Check Google Client ID - Auto-configure if needed
echo -e "${YELLOW}Step 2: Checking Google OAuth configuration...${NC}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GOOGLE_CLIENT_ID=$(cd "$SCRIPT_DIR" && grep "^GOOGLE_CLIENT_ID=" .env 2>/dev/null | cut -d'=' -f2 | tr -d '"' || echo "")

if [ -z "$GOOGLE_CLIENT_ID" ] || [ "$GOOGLE_CLIENT_ID" = "your-google-client-id" ] || [ "$GOOGLE_CLIENT_ID" = "your_google_web_client_id.apps.googleusercontent.com" ]; then
    echo -e "${CYAN}ℹ️  GOOGLE_CLIENT_ID not configured. Using OAuth Playground default (easiest way).${NC}"
    GOOGLE_CLIENT_ID="407408718192.apps.googleusercontent.com"
    echo -e "${GREEN}✅ Will use OAuth Playground client ID: $GOOGLE_CLIENT_ID${NC}"
    echo ""
    echo -e "${YELLOW}💡 Tip: To make this permanent, add to your .env file:${NC}"
    echo "   GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID"
else
    echo -e "${GREEN}✅ GOOGLE_CLIENT_ID is configured: $GOOGLE_CLIENT_ID${NC}"
fi
echo ""

# Guide user to get token
echo -e "${YELLOW}Step 3: Get Google ID Token${NC}"
echo ""
echo -e "${CYAN}📋 Follow these simple steps:${NC}"
echo ""
echo "  1. Open this URL in your browser:"
echo -e "     ${BLUE}https://developers.google.com/oauthplayground/${NC}"
echo ""
echo "  2. In the left panel, find and expand:"
echo "     ${CYAN}Google OAuth2 API v2${NC}"
echo ""
echo "  3. Check these two scopes:"
echo "     ✓ https://www.googleapis.com/auth/userinfo.email"
echo "     ✓ https://www.googleapis.com/auth/userinfo.profile"
echo ""
echo "  4. Click the ${GREEN}'Authorize APIs'${NC} button (top right)"
echo ""
echo "  5. Sign in with your Google account"
echo ""
echo "  6. Click ${GREEN}'Allow'${NC} to grant permissions"
echo ""
echo "  7. Click ${GREEN}'Exchange authorization code for tokens'${NC} button"
echo ""
echo "  8. In the response (right panel), find and copy the ${CYAN}'id_token'${NC} value"
echo "     (It's a long JWT string starting with 'eyJ...')"
echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
read -p "Press Enter when you have copied the id_token..."
echo ""

# Get token from user - handle long JWT tokens properly
echo ""
echo -e "${CYAN}Paste your Google ID token here:${NC}"
echo -e "${YELLOW}(Tip: If pasting doesn't work, you can also save the token to a file and enter the file path)${NC}"
echo ""
echo -n "ID Token (or file path): "

# Read input - could be token or file path
IFS= read -r user_input
user_input=$(echo "$user_input" | xargs)

# Check if it's a file path
if [ -f "$user_input" ]; then
    echo -e "${CYAN}Reading token from file...${NC}"
    ID_TOKEN=$(cat "$user_input" | tr -d '\n\r ' | xargs)
    echo -e "${GREEN}✅ Token read from file${NC}"
else
    # It's the token itself - remove any line breaks
    ID_TOKEN=$(echo "$user_input" | tr -d '\n\r' | xargs)
fi

if [ -z "$ID_TOKEN" ]; then
    echo ""
    echo -e "${RED}❌ No ID token provided.${NC}"
            echo ""
    echo "Please run this script again and provide your Google ID token."
    echo "You can either:"
    echo "  - Paste the token directly"
    echo "  - Save the token to a file and enter the file path"
    exit 1
fi

# Verify it looks like a JWT (starts with eyJ)
if [[ ! "$ID_TOKEN" =~ ^eyJ ]]; then
    echo ""
    echo -e "${YELLOW}⚠️  Warning: The token doesn't start with 'eyJ' (typical JWT format)${NC}"
    echo "This might be okay, but double-check you copied the correct 'id_token' value."
    echo ""
    read -p "Continue anyway? (y/n): " continue_anyway
    if [ "$continue_anyway" != "y" ] && [ "$continue_anyway" != "Y" ]; then
        echo "Exiting. Please run the script again with the correct token."
        exit 1
    fi
fi

echo -e "${GREEN}✅ Token received (${#ID_TOKEN} characters)${NC}"
echo ""

# Test Google signup/login
echo ""
echo -e "${YELLOW}Step 4: Testing Google Signup/Login...${NC}"
echo ""

RESPONSE=$(curl -s -X POST "$BASE_URL/auth/google" \
  -H "Content-Type: application/json" \
  -d "{
    \"idToken\": \"$ID_TOKEN\",
    \"acceptedTerms\": true,
    \"acceptedTermsVer\": \"v1.0\"
  }")

if echo "$RESPONSE" | jq . > /dev/null 2>&1; then
    ACCESS_TOKEN=$(echo "$RESPONSE" | jq -r '.accessToken // empty')
    REFRESH_TOKEN=$(echo "$RESPONSE" | jq -r '.refreshToken // empty')
    
    if [ -n "$ACCESS_TOKEN" ] && [ "$ACCESS_TOKEN" != "null" ] && [ -n "$REFRESH_TOKEN" ] && [ "$REFRESH_TOKEN" != "null" ]; then
        echo -e "${GREEN}✅ Signup/Login successful!${NC}"
        echo "$RESPONSE" | jq .
        echo ""
        echo -e "${CYAN}Tokens saved. Running full end-to-end tests...${NC}"
        echo ""
        
        # Run e2e tests
        ./test-e2e.sh "$ACCESS_TOKEN" "$REFRESH_TOKEN"
    else
        echo -e "${RED}❌ Signup/Login failed${NC}"
        echo "$RESPONSE" | jq .
        echo ""
        echo "Common issues:"
        echo "  - Invalid or expired ID token"
        echo "  - GOOGLE_CLIENT_ID mismatch"
        echo "  - Token audience doesn't match client ID"
    fi
else
    echo -e "${RED}❌ Signup/Login failed (invalid response)${NC}"
    echo "$RESPONSE"
fi


