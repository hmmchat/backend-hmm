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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo -e "${BLUE}🚀 Full Authentication Flow Testing${NC}"
echo ""

# ==========================================
# PHASE 0: CLEANUP AND STARTUP
# ==========================================

echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}PHASE 0: CLEANUP AND STARTUP${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Step 1: Stop all services
echo -e "${YELLOW}Step 0.1: Stopping all services...${NC}"
pkill -f "nest start" 2>/dev/null
pkill -f "node.*main.js" 2>/dev/null
pkill -f "auth-service" 2>/dev/null
pkill -f "user-service" 2>/dev/null
pkill -f "moderation-service" 2>/dev/null
sleep 2
echo -e "${GREEN}✅ All services stopped${NC}"
echo ""

# Step 2: Check infrastructure
echo -e "${YELLOW}Step 0.2: Checking infrastructure...${NC}"
if pg_isready -q 2>/dev/null; then
    echo -e "${GREEN}✅ PostgreSQL is running${NC}"
else
    echo -e "${RED}❌ PostgreSQL is not running. Please start it first.${NC}"
    exit 1
fi

if redis-cli ping > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Redis is running${NC}"
else
    echo -e "${YELLOW}⚠️  Redis is not running (optional for auth-service)${NC}"
fi
echo ""

# Step 3: Start auth-service
echo -e "${YELLOW}Step 0.3: Starting auth-service...${NC}"
cd "$PROJECT_ROOT/apps/auth-service"
npm run start:dev > /tmp/auth-service-test.log 2>&1 &
AUTH_PID=$!
echo "  Started with PID: $AUTH_PID"
echo ""

# Step 4: Wait for service to be ready
echo -e "${YELLOW}Step 0.4: Waiting for auth-service to be ready...${NC}"
MAX_WAIT=30
WAIT_COUNT=0
while [ $WAIT_COUNT -lt $MAX_WAIT ]; do
    # Try health endpoint or auth endpoint to check if service is up
    if curl -s -f "$BASE_URL/health" > /dev/null 2>&1 || \
       curl -s -X POST "$BASE_URL/auth/phone/send-otp" -H "Content-Type: application/json" -d '{"phone":"+918073656316"}' > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Auth service is ready${NC}"
        break
    fi
    WAIT_COUNT=$((WAIT_COUNT + 1))
    sleep 1
    echo -n "."
done
echo ""

if [ $WAIT_COUNT -ge $MAX_WAIT ]; then
    echo -e "${RED}❌ Auth service failed to start within $MAX_WAIT seconds${NC}"
    echo "Check logs: tail -f /tmp/auth-service-test.log"
    kill $AUTH_PID 2>/dev/null
    exit 1
fi
echo ""

# ==========================================
# PHASE 1: TESTING
# ==========================================

echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}PHASE 1: AUTHENTICATION FLOW TESTING${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Check Google Client ID - Auto-configure if needed
echo -e "${YELLOW}Step 1.1: Checking Google OAuth configuration...${NC}"
AUTH_SERVICE_DIR="$PROJECT_ROOT/apps/auth-service"
GOOGLE_CLIENT_ID=$(grep "^GOOGLE_CLIENT_ID=" "$AUTH_SERVICE_DIR/.env" 2>/dev/null | cut -d'=' -f2 | tr -d '"' || echo "")

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

# Step 1.2: Get Google ID Token
echo -e "${YELLOW}Step 1.2: Getting Google ID Token${NC}"
echo ""

# Check for token in multiple places (priority order):
# 1. Environment variable GOOGLE_ID_TOKEN
# 2. Token file: .test-token in test directory
# 3. Token file: .test-token in project root
# 4. Interactive prompt

ID_TOKEN=""
TOKEN_SOURCE=""

if [ -n "$GOOGLE_ID_TOKEN" ]; then
    ID_TOKEN=$(echo "$GOOGLE_ID_TOKEN" | tr -d '\n\r ' | xargs)
    TOKEN_SOURCE="environment variable GOOGLE_ID_TOKEN"
elif [ -f "$SCRIPT_DIR/.test-token" ]; then
    ID_TOKEN=$(cat "$SCRIPT_DIR/.test-token" | tr -d '\n\r ' | xargs)
    TOKEN_SOURCE="file: $SCRIPT_DIR/.test-token"
elif [ -f "$PROJECT_ROOT/.test-token" ]; then
    ID_TOKEN=$(cat "$PROJECT_ROOT/.test-token" | tr -d '\n\r ' | xargs)
    TOKEN_SOURCE="file: $PROJECT_ROOT/.test-token"
fi

if [ -n "$ID_TOKEN" ] && [ ${#ID_TOKEN} -gt 10 ]; then
    echo -e "${GREEN}✅ Token found in $TOKEN_SOURCE${NC}"
    echo -e "${CYAN}   Token length: ${#ID_TOKEN} characters${NC}"
    echo ""
else
    # No token found, show instructions and prompt
    echo -e "${CYAN}📋 No token found. To run tests automatically:${NC}"
    echo ""
    echo "  Option 1: Set environment variable:"
    echo -e "    ${BLUE}export GOOGLE_ID_TOKEN='your_token_here'${NC}"
    echo ""
    echo "  Option 2: Save token to file:"
    echo -e "    ${BLUE}echo 'your_token_here' > $SCRIPT_DIR/.test-token${NC}"
    echo -e "    ${BLUE}# OR${NC}"
    echo -e "    ${BLUE}echo 'your_token_here' > $PROJECT_ROOT/.test-token${NC}"
    echo ""
    echo -e "${CYAN}📋 To get a Google ID Token:${NC}"
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
    echo -e "${CYAN}Paste your Google ID token here (or press Ctrl+C to save to file first):${NC}"
    echo ""
    echo -n "ID Token: "
    
    # Read input - handle long JWT tokens properly
    IFS= read -r user_input
    user_input=$(echo "$user_input" | tr -d '\n\r' | xargs)
    
    if [ -f "$user_input" ]; then
        echo -e "${CYAN}Reading token from file...${NC}"
        ID_TOKEN=$(cat "$user_input" | tr -d '\n\r ' | xargs)
        TOKEN_SOURCE="file: $user_input"
    else
        ID_TOKEN=$(echo "$user_input" | tr -d '\n\r' | xargs)
        TOKEN_SOURCE="manual input"
    fi
fi

if [ -z "$ID_TOKEN" ] || [ ${#ID_TOKEN} -lt 10 ]; then
    echo ""
    echo -e "${RED}❌ No valid ID token provided.${NC}"
    echo ""
    echo "Please provide your Google ID token using one of these methods:"
    echo "  1. Set GOOGLE_ID_TOKEN environment variable"
    echo "  2. Save token to: $SCRIPT_DIR/.test-token"
    echo "  3. Save token to: $PROJECT_ROOT/.test-token"
    echo "  4. Paste token when prompted"
    exit 1
fi

# Verify it looks like a JWT (starts with eyJ)
if [[ ! "$ID_TOKEN" =~ ^eyJ ]]; then
    echo ""
    echo -e "${YELLOW}⚠️  Warning: The token doesn't start with 'eyJ' (typical JWT format)${NC}"
    echo "This might be okay, but double-check you copied the correct 'id_token' value."
    echo ""
    if [ "$TOKEN_SOURCE" = "manual input" ]; then
        read -p "Continue anyway? (y/n): " continue_anyway
        if [ "$continue_anyway" != "y" ] && [ "$continue_anyway" != "Y" ]; then
            echo "Exiting. Please run the script again with the correct token."
            exit 1
        fi
    else
        echo -e "${YELLOW}   Continuing with token from $TOKEN_SOURCE...${NC}"
    fi
fi

echo -e "${GREEN}✅ Token ready from $TOKEN_SOURCE (${#ID_TOKEN} characters)${NC}"
echo ""

# Test Google signup/login
echo ""
echo -e "${YELLOW}Step 1.3: Testing Google Signup/Login...${NC}"
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
        
        echo -e "${GREEN}✅ Authentication flow test completed successfully!${NC}"
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


