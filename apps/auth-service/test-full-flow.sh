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

# Check Google Client ID
echo -e "${YELLOW}Step 2: Checking Google OAuth configuration...${NC}"
GOOGLE_CLIENT_ID=$(cd /Users/arya.prakash/backend-hmm/apps/auth-service && grep "^GOOGLE_CLIENT_ID=" .env 2>/dev/null | cut -d'=' -f2 | tr -d '"' || echo "")

if [ -z "$GOOGLE_CLIENT_ID" ] || [ "$GOOGLE_CLIENT_ID" = "your-google-client-id" ] || [ "$GOOGLE_CLIENT_ID" = "your_google_web_client_id.apps.googleusercontent.com" ]; then
    echo -e "${YELLOW}⚠️  GOOGLE_CLIENT_ID not configured or using placeholder${NC}"
    echo ""
    echo "Options:"
    echo "  1. Use OAuth Playground default (quickest)"
    echo "  2. Set up your own Google Client ID"
    echo ""
    read -p "Use OAuth Playground default client ID? (y/n): " use_playground
    
    if [ "$use_playground" = "y" ] || [ "$use_playground" = "Y" ]; then
        GOOGLE_CLIENT_ID="407408718192.apps.googleusercontent.com"
        echo -e "${CYAN}Using OAuth Playground client ID: $GOOGLE_CLIENT_ID${NC}"
        echo ""
        echo "To make this permanent, add to .env:"
        echo "GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID"
    else
        echo ""
        echo "Please set GOOGLE_CLIENT_ID in your .env file and restart the service."
        echo "Then run this script again."
        exit 1
    fi
else
    echo -e "${GREEN}✅ GOOGLE_CLIENT_ID is configured: $GOOGLE_CLIENT_ID${NC}"
fi
echo ""

# Guide user to get token
echo -e "${YELLOW}Step 3: Get Google ID Token${NC}"
echo ""
echo -e "${CYAN}Follow these steps:${NC}"
echo "  1. Open: https://developers.google.com/oauthplayground/"
echo "  2. In left panel, find 'Google OAuth2 API v2'"
echo "  3. Select scopes:"
echo "     - https://www.googleapis.com/auth/userinfo.email"
echo "     - https://www.googleapis.com/auth/userinfo.profile"
echo "  4. Click 'Authorize APIs'"
echo "  5. Sign in with Google"
echo "  6. Click 'Allow'"
echo "  7. Click 'Exchange authorization code for tokens'"
echo "  8. Copy the 'id_token' value (long JWT string)"
echo ""
read -p "Press Enter when you have the id_token ready..."
echo ""

# Get token from user
echo -e "${CYAN}Paste your Google ID token here (or press Enter to skip OAuth test):${NC}"
read -p "ID Token: " ID_TOKEN

if [ -z "$ID_TOKEN" ]; then
    echo -e "${YELLOW}Skipping OAuth test. You can test token-based flows if you have tokens.${NC}"
    echo ""
    read -p "Do you have access and refresh tokens to test? (y/n): " has_tokens
    if [ "$has_tokens" = "y" ] || [ "$has_tokens" = "Y" ]; then
        read -p "Access Token: " ACCESS_TOKEN
        read -p "Refresh Token: " REFRESH_TOKEN
        if [ -n "$ACCESS_TOKEN" ] && [ -n "$REFRESH_TOKEN" ]; then
            echo ""
            echo -e "${GREEN}Running end-to-end tests with your tokens...${NC}"
            ./test-e2e.sh "$ACCESS_TOKEN" "$REFRESH_TOKEN"
            exit 0
        fi
    fi
    echo ""
    echo "No tokens provided. Exiting."
    echo "To test OAuth, run this script again and provide an ID token."
    exit 0
fi

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

