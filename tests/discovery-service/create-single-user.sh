#!/bin/bash

# Script to create a single test user using Phone OTP
# Usage: ./create-single-user.sh <GENDER> <PHONE>
# Example: ./create-single-user.sh FEMALE +918073656317

AUTH_SERVICE_URL="http://localhost:3001"
USER_SERVICE_URL="http://localhost:3002"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOKENS_FILE="$SCRIPT_DIR/.test-tokens"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

GENDER="${1:-}"
PHONE="${2:-}"

if [ -z "$GENDER" ] || [ -z "$PHONE" ]; then
    echo -e "${RED}Usage: $0 <GENDER> <PHONE>${NC}"
    echo "Example: $0 FEMALE +918073656317"
    echo ""
    echo "Valid genders: MALE, FEMALE, NON_BINARY, PREFER_NOT_TO_SAY"
    exit 1
fi

# Validate gender
case "$GENDER" in
    MALE|FEMALE|NON_BINARY|PREFER_NOT_TO_SAY)
        ;;
    *)
        echo -e "${RED}Invalid gender: $GENDER${NC}"
        echo "Valid genders: MALE, FEMALE, NON_BINARY, PREFER_NOT_TO_SAY"
        exit 1
        ;;
esac

echo -e "${BLUE}=========================================="
echo -e "  CREATING $GENDER USER"
echo -e "==========================================${NC}"
echo ""
echo -e "${CYAN}Phone: $PHONE${NC}"
echo -e "${CYAN}Gender: $GENDER${NC}"
echo ""

# Check services
echo -e "${CYAN}Checking services...${NC}"
if ! curl -s "$AUTH_SERVICE_URL/auth/phone/send-otp" > /dev/null 2>&1; then
    echo -e "${RED}❌ Auth service is not running${NC}"
    exit 1
fi

if ! curl -s "$USER_SERVICE_URL/metrics/active-meetings" > /dev/null 2>&1; then
    echo -e "${RED}❌ User service is not running${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Services are running${NC}"
echo ""

# Function to get user ID from access token
get_user_id() {
    local ACCESS_TOKEN=$1
    
    USER_ID=$(echo "$ACCESS_TOKEN" | cut -d'.' -f2 | python3 -c "
import sys
import base64
import json

try:
    payload = sys.stdin.read().strip()
    padding = 4 - len(payload) % 4
    if padding != 4:
        payload += '=' * padding
    payload = payload.replace('-', '+').replace('_', '/')
    decoded = base64.b64decode(payload)
    data = json.loads(decoded)
    print(data.get('sub', ''))
except Exception:
    print('', end='')
" 2>/dev/null || echo "")
    
    echo "$USER_ID"
}

# Step 1: Send OTP
echo -e "${CYAN}Step 1: Sending OTP to $PHONE...${NC}"
SEND_RESPONSE=$(curl -s -X POST "$AUTH_SERVICE_URL/auth/phone/send-otp" \
    -H "Content-Type: application/json" \
    -d "{\"phone\": \"$PHONE\"}")

if echo "$SEND_RESPONSE" | grep -q "error\|Error"; then
    echo -e "${RED}❌ Failed to send OTP${NC}"
    echo "  Response: $SEND_RESPONSE"
    exit 1
fi

echo -e "${GREEN}✅ OTP sent successfully${NC}"
echo ""

# Step 2: Prompt for OTP
echo -e "${CYAN}Step 2: Please check your phone for the OTP code${NC}"
read -p "Enter OTP code for $PHONE: " OTP_CODE

if [ -z "$OTP_CODE" ]; then
    echo -e "${RED}❌ OTP code cannot be empty${NC}"
    exit 1
fi

# Step 3: Verify OTP and get token
echo -e "${CYAN}Step 3: Verifying OTP...${NC}"
VERIFY_RESPONSE=$(curl -s -X POST "$AUTH_SERVICE_URL/auth/phone/verify" \
    -H "Content-Type: application/json" \
    -d "{
        \"phone\": \"$PHONE\",
        \"code\": \"$OTP_CODE\",
        \"acceptedTerms\": true,
        \"acceptedTermsVer\": \"v1.0\"
    }")

ACCESS_TOKEN=$(echo "$VERIFY_RESPONSE" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
REFRESH_TOKEN=$(echo "$VERIFY_RESPONSE" | grep -o '"refreshToken":"[^"]*"' | cut -d'"' -f4)
ERROR_MSG=$(echo "$VERIFY_RESPONSE" | grep -o '"message":"[^"]*"' | cut -d'"' -f4)

if [ -z "$ACCESS_TOKEN" ]; then
    echo -e "${RED}❌ OTP verification failed${NC}"
    if [ ! -z "$ERROR_MSG" ]; then
        echo "  Error: $ERROR_MSG"
    else
        echo "  Response: $VERIFY_RESPONSE"
    fi
    exit 1
fi

echo -e "${GREEN}✅ OTP verified, access token obtained${NC}"
echo ""

# Step 4: Get user ID
USER_ID=$(get_user_id "$ACCESS_TOKEN")

if [ -z "$USER_ID" ]; then
    echo -e "${RED}❌ Could not extract user ID from token${NC}"
    exit 1
fi

echo -e "${CYAN}Step 4: Creating user profile...${NC}"
echo "  User ID: $USER_ID"
echo "  Gender: $GENDER"

# Step 5: Calculate DOB (25 years ago)
DOB=$(date -v-25y -u +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null || date -d "25 years ago" -u +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null || echo "1999-01-01T00:00:00.000Z")

# Use placeholder image (may fail moderation, but that's okay for testing)
PLACEHOLDER_IMAGE="https://via.placeholder.com/400"

# Step 6: Create profile with gender
CREATE_RESPONSE=$(curl -s -X POST "$USER_SERVICE_URL/users/$USER_ID/profile" \
    -H "Content-Type: application/json" \
    -d "{
        \"username\": \"test${GENDER,,}\",
        \"dateOfBirth\": \"$DOB\",
        \"gender\": \"$GENDER\",
        \"displayPictureUrl\": \"$PLACEHOLDER_IMAGE\"
    }")

if echo "$CREATE_RESPONSE" | grep -q "error\|Error"; then
    if echo "$CREATE_RESPONSE" | grep -q "already exists"; then
        echo -e "${YELLOW}  ⚠️  Profile already exists, updating gender...${NC}"
        UPDATE_RESPONSE=$(curl -s -X PATCH "$USER_SERVICE_URL/me/profile" \
            -H "Authorization: Bearer $ACCESS_TOKEN" \
            -H "Content-Type: application/json" \
            -d "{\"gender\": \"$GENDER\"}" 2>/dev/null)
        
        if echo "$UPDATE_RESPONSE" | grep -q "error\|Error"; then
            echo -e "${YELLOW}  ⚠️  Could not update gender (may need moderation service)${NC}"
            echo "  Response: $UPDATE_RESPONSE"
        else
            echo -e "${GREEN}  ✅ Gender updated to $GENDER${NC}"
        fi
    else
        echo -e "${RED}  ❌ Profile creation failed${NC}"
        echo "  Response: $CREATE_RESPONSE"
        exit 1
    fi
else
    echo -e "${GREEN}  ✅ Profile created with gender $GENDER${NC}"
fi

echo ""

# Step 7: Save token
if [ ! -f "$TOKENS_FILE" ]; then
    touch "$TOKENS_FILE"
    chmod 600 "$TOKENS_FILE"
fi

TOKEN_VAR="TOKEN_$GENDER"
REFRESH_TOKEN_VAR="REFRESH_TOKEN_$GENDER"

# Remove old tokens
sed -i.bak "/^export $TOKEN_VAR=/d" "$TOKENS_FILE" 2>/dev/null || sed -i '' "/^export $TOKEN_VAR=/d" "$TOKENS_FILE" 2>/dev/null
sed -i.bak "/^export $REFRESH_TOKEN_VAR=/d" "$TOKENS_FILE" 2>/dev/null || sed -i '' "/^export $REFRESH_TOKEN_VAR=/d" "$TOKENS_FILE" 2>/dev/null

# Save access token
echo "export $TOKEN_VAR=\"$ACCESS_TOKEN\"" >> "$TOKENS_FILE"

# Save refresh token if available (for future token refresh)
if [ ! -z "$REFRESH_TOKEN" ]; then
    echo "export $REFRESH_TOKEN_VAR=\"$REFRESH_TOKEN\"" >> "$TOKENS_FILE"
fi

rm -f "$TOKENS_FILE.bak" 2>/dev/null

echo -e "${GREEN}✅ Token saved as $TOKEN_VAR${NC}"
if [ ! -z "$REFRESH_TOKEN" ]; then
    echo -e "${GREEN}✅ Refresh token saved as $REFRESH_TOKEN_VAR${NC}"
fi
echo ""
echo -e "${BLUE}=========================================="
echo -e "${GREEN}✅ $GENDER user created successfully!${NC}"
echo -e "${BLUE}==========================================${NC}"
echo ""
echo "To create other users, run:"
echo "  ./create-single-user.sh FEMALE +918073656317"
echo "  ./create-single-user.sh NON_BINARY +918073656318"
echo "  ./create-single-user.sh PREFER_NOT_TO_SAY +918073656319"
echo ""

