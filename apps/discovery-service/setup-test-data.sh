#!/bin/bash

# Setup script for discovery service test data
# This script creates test users with proper profiles for discovery service testing
# 
# NOTE: This script now uses API Gateway endpoints (recommended for frontend team)
# The HTML test interface has been moved to: tests/html-interfaces/discovery-service.html

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Use API Gateway (recommended)
GATEWAY_URL="${GATEWAY_URL:-http://localhost:3000}"
API_VERSION="/v1"

# Direct service URLs (fallback if gateway is not available)
DISCOVERY_URL="${DISCOVERY_URL:-http://localhost:3004}"
USER_URL="${USER_URL:-http://localhost:3002}"
WALLET_URL="${WALLET_URL:-http://localhost:3005}"

USE_GATEWAY="${USE_GATEWAY:-true}"

if [ "$USE_GATEWAY" = "true" ]; then
    USER_ENDPOINT="${GATEWAY_URL}${API_VERSION}/users"
    WALLET_ENDPOINT="${GATEWAY_URL}${API_VERSION}/wallet"
else
    USER_ENDPOINT="${USER_URL}"
    WALLET_ENDPOINT="${WALLET_URL}"
fi

echo "🔧 Setting up Discovery Service Test Data..."
echo ""

# Test user IDs
TEST_USER_1="test-discovery-1"
TEST_USER_2="test-discovery-2"
TEST_USER_3="test-discovery-3"
TEST_USER_4="test-discovery-4"

# Function to create user profile
create_user_profile() {
    local user_id=$1
    local username=$2
    local gender=$3
    local city=$4
    local lat=$5
    local lng=$6
    
    echo "Creating profile for ${user_id}..."
    
    local profile_data=$(cat <<EOF
{
  "username": "${username}",
  "dateOfBirth": "1998-01-15T00:00:00.000Z",
  "gender": "${gender}",
  "displayPictureUrl": "https://via.placeholder.com/300",
  "intent": "Looking for meaningful connections",
  "latitude": ${lat},
  "longitude": ${lng},
  "preferredCity": "${city}"
}
EOF
)
    
    if [ "$USE_GATEWAY" = "true" ]; then
        # Try test endpoint first (PATCH)
        curl -s -X PATCH "${USER_ENDPOINT}/test/${user_id}/profile" \
            -H "Content-Type: application/json" \
            -d "${profile_data}" > /dev/null || \
        # Fallback to POST
        curl -s -X POST "${USER_ENDPOINT}/${user_id}/profile" \
            -H "Content-Type: application/json" \
            -d "${profile_data}" > /dev/null || echo "  ⚠️  Profile may already exist or service not running"
    else
        curl -s -X POST "${USER_ENDPOINT}/users/${user_id}/profile" \
            -H "Content-Type: application/json" \
            -d "${profile_data}" > /dev/null || echo "  ⚠️  Profile may already exist or user-service not running"
    fi
}

# Function to add coins to wallet
add_coins() {
    local user_id=$1
    local amount=$2
    
    if [ "$USE_GATEWAY" = "true" ]; then
        curl -s -X POST "${WALLET_ENDPOINT}/test/wallet/add-coins" \
            -H "Content-Type: application/json" \
            -d "{\"userId\": \"${user_id}\", \"amount\": ${amount}, \"description\": \"test_setup\"}" > /dev/null || true
    else
        curl -s -X POST "${WALLET_ENDPOINT}/test/wallet/add-coins" \
            -H "Content-Type: application/json" \
            -d "{\"userId\": \"${user_id}\", \"amount\": ${amount}, \"description\": \"test_setup\"}" > /dev/null || true
    fi
}

echo "📝 Creating test user profiles..."

# Create profiles for test users
create_user_profile "${TEST_USER_1}" "discovery_user_1" "MALE" "Mumbai" 19.0760 72.8777
create_user_profile "${TEST_USER_2}" "discovery_user_2" "FEMALE" "Mumbai" 19.0760 72.8777
create_user_profile "${TEST_USER_3}" "discovery_user_3" "MALE" "Delhi" 28.6139 77.2090
create_user_profile "${TEST_USER_4}" "discovery_user_4" "FEMALE" "Bangalore" 12.9716 77.5946

echo ""
echo "💰 Adding coins to wallets..."

# Add coins to wallets
add_coins "${TEST_USER_1}" 10000
add_coins "${TEST_USER_2}" 10000
add_coins "${TEST_USER_3}" 10000
add_coins "${TEST_USER_4}" 10000

echo ""
echo "🌱 Running discovery service seed..."

# Run discovery service seed
cd "${SCRIPT_DIR}"
if npm run seed > /dev/null 2>&1; then
    echo "  ✅ Seed completed"
else
    echo "  ⚠️  Seed may have issues (check if already seeded)"
fi

echo ""
echo "✅ Test data setup complete!"
echo ""
echo "Test Users:"
echo "  - ${TEST_USER_1} (MALE, Mumbai)"
echo "  - ${TEST_USER_2} (FEMALE, Mumbai)"
echo "  - ${TEST_USER_3} (MALE, Delhi)"
echo "  - ${TEST_USER_4} (FEMALE, Bangalore)"
echo ""
echo "You can now use the HTML test interface to test discovery service!"
echo ""
if [ "$USE_GATEWAY" = "true" ]; then
    echo "📡 Using API Gateway: ${GATEWAY_URL}"
    echo "🌐 HTML Interface: tests/html-interfaces/discovery-service.html"
else
    echo "📡 Using direct service URLs"
    echo "To use API Gateway instead, set: USE_GATEWAY=true ./setup-test-data.sh"
fi
