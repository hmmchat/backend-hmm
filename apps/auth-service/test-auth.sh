#!/bin/bash

# Auth Service Testing Script
# Usage: ./test-auth.sh

BASE_URL="${BASE_URL:-http://localhost:3001}"
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🧪 Testing Auth Service${NC}"
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

# Test metrics endpoint
echo -e "${YELLOW}2. Testing metrics endpoint...${NC}"
METRICS_RESPONSE=$(curl -s "$BASE_URL/me/metrics")
if echo "$METRICS_RESPONSE" | jq . > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Metrics endpoint working${NC}"
    echo "$METRICS_RESPONSE" | jq .
else
    echo -e "${RED}❌ Metrics endpoint failed${NC}"
    echo "$METRICS_RESPONSE"
fi
echo ""

# Test phone OTP send (will fail without Twilio, but tests endpoint)
echo -e "${YELLOW}3. Testing phone OTP send endpoint...${NC}"
OTP_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/phone/send-otp" \
  -H "Content-Type: application/json" \
  -d '{"phone": "1234567890"}')
if echo "$OTP_RESPONSE" | jq . > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Phone OTP endpoint accessible${NC}"
    echo "$OTP_RESPONSE" | jq .
else
    echo -e "${YELLOW}⚠️  Phone OTP endpoint response (may need Twilio config):${NC}"
    echo "$OTP_RESPONSE"
fi
echo ""

# Test validation (should fail without acceptedTerms)
echo -e "${YELLOW}4. Testing validation (should fail without acceptedTerms)...${NC}"
VALIDATION_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/google" \
  -H "Content-Type: application/json" \
  -d '{"idToken": "test"}')
if echo "$VALIDATION_RESPONSE" | grep -q "acceptedTerms\|validation" || echo "$VALIDATION_RESPONSE" | grep -q "error"; then
    echo -e "${GREEN}✅ Validation is working${NC}"
    echo "$VALIDATION_RESPONSE" | jq . 2>/dev/null || echo "$VALIDATION_RESPONSE"
else
    echo -e "${YELLOW}⚠️  Unexpected response:${NC}"
    echo "$VALIDATION_RESPONSE"
fi
echo ""

# Test unauthorized access to /me
echo -e "${YELLOW}5. Testing unauthorized access to /me...${NC}"
ME_RESPONSE=$(curl -s -w "\n%{http_code}" "$BASE_URL/me" | tail -1)
if [ "$ME_RESPONSE" = "401" ]; then
    echo -e "${GREEN}✅ Authorization check is working (401 as expected)${NC}"
else
    echo -e "${YELLOW}⚠️  Got status code: $ME_RESPONSE${NC}"
fi
echo ""

echo -e "${GREEN}✅ Basic endpoint tests complete!${NC}"
echo ""
echo -e "${YELLOW}📝 Next steps:${NC}"
echo "  1. Test OAuth flows with real tokens (Google, Facebook, Apple)"
echo "  2. Test phone OTP with real Twilio credentials"
echo "  3. Test full user flow: signup → get me → update preferences → logout"
echo ""
echo "See TESTING.md for detailed instructions"

