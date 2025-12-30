#!/bin/bash

# Test script for gender change functionality
# Requires: User service running on port 3002
# Requires: Access token for authentication

USER_SERVICE_URL="http://localhost:3002"
ACCESS_TOKEN="${ACCESS_TOKEN:-}"  # Set ACCESS_TOKEN env var or pass as argument

if [ -z "$ACCESS_TOKEN" ]; then
    echo "⚠️  ACCESS_TOKEN not set. Please set it as environment variable:"
    echo "   export ACCESS_TOKEN=your_access_token"
    echo ""
    echo "To get an access token, sign up via auth-service first."
    exit 1
fi

TIMESTAMP=$(date +%s)
USER_ID="testuser_gender_$TIMESTAMP"
USERNAME="testuser$TIMESTAMP"

echo "=== Test: Gender Change from PREFER_NOT_TO_SAY ==="
echo ""

# Step 1: Create profile with PREFER_NOT_TO_SAY
echo "Step 1: Creating profile with gender: PREFER_NOT_TO_SAY"
CREATE_RESPONSE=$(curl -s -X POST "$USER_SERVICE_URL/users/$USER_ID/profile" \
  -H "Content-Type: application/json" \
  -d "{
    \"username\": \"$USERNAME\",
    \"dateOfBirth\": \"2000-01-01T00:00:00Z\",
    \"gender\": \"PREFER_NOT_TO_SAY\",
    \"displayPictureUrl\": \"https://example.com/safe-profile.jpg\"
  }")

echo "$CREATE_RESPONSE" | jq '.user | {id, username, gender, genderChanged}'
echo ""

# Step 2: Change gender from PREFER_NOT_TO_SAY to MALE (should succeed)
echo "Step 2: Changing gender from PREFER_NOT_TO_SAY to MALE (should succeed)"
UPDATE1_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X PATCH "$USER_SERVICE_URL/me/profile" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"gender": "MALE"}')

HTTP_STATUS1=$(echo "$UPDATE1_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
BODY1=$(echo "$UPDATE1_RESPONSE" | sed '/HTTP_STATUS/d')

if [ "$HTTP_STATUS1" = "200" ]; then
    echo "✅ SUCCESS: Gender changed to MALE"
    echo "$BODY1" | jq '.user | {gender, genderChanged}'
else
    echo "❌ FAILED: Expected HTTP 200, got $HTTP_STATUS1"
    echo "$BODY1" | jq .
fi
echo ""

# Step 3: Try to change gender again (should fail)
echo "Step 3: Trying to change gender again to FEMALE (should fail)"
UPDATE2_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X PATCH "$USER_SERVICE_URL/me/profile" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"gender": "FEMALE"}')

HTTP_STATUS2=$(echo "$UPDATE2_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
BODY2=$(echo "$UPDATE2_RESPONSE" | sed '/HTTP_STATUS/d')

if [ "$HTTP_STATUS2" = "400" ]; then
    echo "✅ SUCCESS: Correctly rejected second gender change"
    echo "$BODY2" | jq '.message'
else
    echo "❌ FAILED: Expected HTTP 400, got $HTTP_STATUS2"
    echo "$BODY2" | jq .
fi
echo ""

echo "=== Test Complete ==="
