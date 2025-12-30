#!/bin/bash

# Quick script to test Phone OTP flow
BASE_URL="${BASE_URL:-http://localhost:3001}"
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}📱 Phone OTP Testing${NC}"
echo ""

# Get phone number
echo -e "${YELLOW}Enter your phone number (with country code, e.g., +1234567890):${NC}"
read -p "Phone: " PHONE

if [ -z "$PHONE" ]; then
    echo -e "${RED}❌ Phone number required${NC}"
    exit 1
fi

# Send OTP
echo ""
echo -e "${YELLOW}Step 1: Sending OTP...${NC}"
RESPONSE=$(curl -s -X POST "$BASE_URL/auth/phone/send-otp" \
  -H "Content-Type: application/json" \
  -d "{\"phone\": \"$PHONE\"}")

if echo "$RESPONSE" | jq . > /dev/null 2>&1; then
    echo -e "${GREEN}✅ OTP sent successfully${NC}"
    echo "$RESPONSE" | jq .
else
    echo -e "${RED}❌ Failed to send OTP${NC}"
    echo "$RESPONSE"
    exit 1
fi

echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}Check your phone for the OTP code (6 digits)${NC}"
echo ""

# Get OTP code
read -p "Enter the OTP code you received: " OTP_CODE

if [ -z "$OTP_CODE" ]; then
    echo -e "${RED}❌ OTP code required${NC}"
    exit 1
fi

# Verify OTP
echo ""
echo -e "${YELLOW}Step 2: Verifying OTP and getting tokens...${NC}"
RESPONSE=$(curl -s -X POST "$BASE_URL/auth/phone/verify" \
  -H "Content-Type: application/json" \
  -d "{
    \"phone\": \"$PHONE\",
    \"code\": \"$OTP_CODE\",
    \"acceptedTerms\": true,
    \"acceptedTermsVer\": \"v1.0\"
  }")

if echo "$RESPONSE" | jq . > /dev/null 2>&1; then
    ACCESS_TOKEN=$(echo "$RESPONSE" | jq -r '.accessToken // empty')
    REFRESH_TOKEN=$(echo "$RESPONSE" | jq -r '.refreshToken // empty')
    
    if [ -n "$ACCESS_TOKEN" ] && [ "$ACCESS_TOKEN" != "null" ] && [ -n "$REFRESH_TOKEN" ] && [ "$REFRESH_TOKEN" != "null" ]; then
        echo -e "${GREEN}✅ Verification successful!${NC}"
        echo ""
        echo "$RESPONSE" | jq .
        echo ""
        echo -e "${CYAN}Tokens received:${NC}"
        echo "  Access Token: ${ACCESS_TOKEN:0:50}..."
        echo "  Refresh Token: ${REFRESH_TOKEN:0:50}..."
        echo ""
        echo -e "${YELLOW}Would you like to run end-to-end tests with these tokens? (y/n):${NC}"
        read -p "Run tests: " run_tests
        
        if [ "$run_tests" = "y" ] || [ "$run_tests" = "Y" ]; then
            echo ""
            SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
            "$SCRIPT_DIR/test-e2e.sh" "$ACCESS_TOKEN" "$REFRESH_TOKEN"
        else
            echo ""
            echo -e "${CYAN}To run tests later, use:${NC}"
            echo "  ../../tests/auth-service/test-e2e.sh \"$ACCESS_TOKEN\" \"$REFRESH_TOKEN\""
        fi
    else
        echo -e "${RED}❌ Verification failed${NC}"
        echo "$RESPONSE" | jq .
    fi
else
    echo -e "${RED}❌ Verification failed (invalid response)${NC}"
    echo "$RESPONSE"
fi
