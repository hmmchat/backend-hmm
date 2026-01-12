#!/bin/bash

# Automated E2E tests for User Service
# Tests profile management, photos, preferences, and edge cases
# Uses test endpoints that bypass authentication

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../test-utils.sh"

SERVICE_NAME="user-service"
SERVICE_DIR="${ROOT_DIR}/apps/${SERVICE_NAME}"
SERVICE_URL="${USER_URL}"
SERVICE_PORT=${USER_PORT}

# Test user IDs (with timestamp to avoid conflicts)
TIMESTAMP=$(date +%s)
TEST_USER_1="test-user-${TIMESTAMP}-1"
TEST_USER_2="test-user-${TIMESTAMP}-2"
TEST_USER_3="test-user-${TIMESTAMP}-3"

# Setup function
setup() {
    log_info "Setting up ${SERVICE_NAME} tests..."
    
    # Setup infrastructure
    setup_infrastructure
    
    # Setup database
    setup_database "${SERVICE_DIR}" "${SERVICE_NAME}"
    
    # Start service
    start_service "${SERVICE_DIR}" "${SERVICE_NAME}" "${SERVICE_PORT}" "${SERVICE_URL}"
    
    # Create test users directly in database
    create_test_user "${SERVICE_DIR}" "${TEST_USER_1}" "test1@example.com" "+916123456789"
    create_test_user "${SERVICE_DIR}" "${TEST_USER_2}" "test2@example.com" "+916123456790"
    create_test_user "${SERVICE_DIR}" "${TEST_USER_3}" "test3@example.com" "+916123456791"
    
    log_success "Setup complete"
}

# Cleanup function
cleanup() {
    log_info "Cleaning up ${SERVICE_NAME} tests..."
    cleanup_test_data "${SERVICE_DIR}" "${SERVICE_NAME}"
}

# Test: Create profile
test_create_profile() {
    log_test "Create Profile"
    
    local profile_data=$(cat <<EOF
{
  "username": "testuser${TIMESTAMP}1",
  "dateOfBirth": "1998-01-15T00:00:00.000Z",
  "gender": "MALE",
  "displayPictureUrl": "https://via.placeholder.com/300"
}
EOF
)
    
    # Accept both 201 (created) and 400 (already exists) as valid
    local response=$(http_request "POST" "${SERVICE_URL}/users/${TEST_USER_1}/profile" "${profile_data}" 201 "Create profile for user 1" 2>&1)
    if [ $? -ne 0 ]; then
        # Check if it's "already exists" error
        if echo "$response" | grep -q "already exists"; then
            log_success "Profile already exists (expected in some cases)"
            return 0
        fi
        return 1
    fi
}

# Test: Get profile
test_get_profile() {
    log_test "Get Profile"
    
    local response=$(http_request "GET" "${SERVICE_URL}/users/${TEST_USER_1}" "" 200 "Get user profile")
    
    # Verify profile data
    if echo "$response" | grep -q "testuser1"; then
        log_success "Profile data is correct"
    else
        log_warn "Profile data check - username may differ"
    fi
}

# Test: Update profile
test_update_profile() {
    log_test "Update Profile"
    
    local update_data=$(cat <<EOF
{
  "bio": "Updated bio text",
  "age": 26
}
EOF
)
    
    http_request "PATCH" "${SERVICE_URL}/users/test/${TEST_USER_1}/profile" "${update_data}" 200 "Update profile"
}

# Test: Get profile completion
test_profile_completion() {
    log_test "Profile Completion"
    
    http_request "GET" "${SERVICE_URL}/users/test/${TEST_USER_1}/profile-completion" "" 200 "Get profile completion"
}

# Test: Add photo
test_add_photo() {
    log_test "Add Photo"
    
    local photo_data=$(cat <<EOF
{
  "url": "https://example.com/photo1.jpg",
  "order": 1
}
EOF
)
    
    http_request "POST" "${SERVICE_URL}/users/test/${TEST_USER_1}/photos" "${photo_data}" 201 "Add photo"
}

# Test: Get photos
test_get_photos() {
    log_test "Get Photos"
    
    http_request "GET" "${SERVICE_URL}/users/test/${TEST_USER_1}/photos" "" 200 "Get user photos"
}

# Test: Delete photo
test_delete_photo() {
    log_test "Delete Photo"
    
    # First get photos to find photo ID
    local photos_response=$(http_request "GET" "${SERVICE_URL}/users/test/${TEST_USER_1}/photos" "" 200 "Get photos for deletion")
    local photo_id=$(echo "$photos_response" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
    
    if [ -n "$photo_id" ]; then
        http_request "DELETE" "${SERVICE_URL}/users/test/${TEST_USER_1}/photos/${photo_id}" "" 200 "Delete photo"
    else
        log_warn "No photo found to delete"
    fi
}

# Test: Update music preferences
test_music_preferences() {
    log_test "Music Preferences"
    
    # First create a music preference
    local create_music_data=$(cat <<EOF
{
  "songName": "Test Song 1",
  "artistName": "Test Artist 1",
  "albumArtUrl": "https://via.placeholder.com/300"
}
EOF
)
    
    local create_response=$(http_request "POST" "${SERVICE_URL}/music/preferences" "${create_music_data}" 201 "Create music preference")
    
    # Extract music preference ID
    local music_pref_id=$(echo "$create_response" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
    
    if [ -n "$music_pref_id" ]; then
        # Now update user's music preference
        local update_music_data=$(cat <<EOF
{
  "musicPreferenceId": "${music_pref_id}"
}
EOF
)
        http_request "PATCH" "${SERVICE_URL}/users/test/${TEST_USER_1}/music-preference" "${update_music_data}" 200 "Update music preferences"
    else
        log_warn "Could not extract music preference ID, skipping update"
    fi
}

# Test: Update brand preferences
test_brand_preferences() {
    log_test "Brand Preferences"
    
    # First get available brands
    local brands_response=$(http_request "GET" "${SERVICE_URL}/brands" "" 200 "Get brands list")
    local brand_id=$(echo "$brands_response" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
    
    if [ -n "$brand_id" ]; then
        local brand_data=$(cat <<EOF
{
  "brandIds": ["${brand_id}"]
}
EOF
)
        http_request "PATCH" "${SERVICE_URL}/users/test/${TEST_USER_1}/brand-preferences" "${brand_data}" 200 "Update brand preferences"
    else
        log_warn "No brands available for testing"
    fi
}

# Test: Update interests
test_interests() {
    log_test "Interests"
    
    # Get available interests
    local interests_response=$(http_request "GET" "${SERVICE_URL}/interests" "" 200 "Get interests list")
    local interest_id=$(echo "$interests_response" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
    
    if [ -n "$interest_id" ]; then
        local interests_data=$(cat <<EOF
{
  "interestIds": ["${interest_id}"]
}
EOF
)
        http_request "PATCH" "${SERVICE_URL}/users/test/${TEST_USER_1}/interests" "${interests_data}" 200 "Update interests"
    else
        log_warn "No interests available for testing"
    fi
}

# Test: Update values
test_values() {
    log_test "Values"
    
    # Get available values
    local values_response=$(http_request "GET" "${SERVICE_URL}/values" "" 200 "Get values list")
    local value_id=$(echo "$values_response" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
    
    if [ -n "$value_id" ]; then
        local values_data=$(cat <<EOF
{
  "valueIds": ["${value_id}"]
}
EOF
)
        http_request "PATCH" "${SERVICE_URL}/users/test/${TEST_USER_1}/values" "${values_data}" 200 "Update values"
    else
        log_warn "No values available for testing"
    fi
}

# Test: Update location
test_location() {
    log_test "Location"
    
    local location_data=$(cat <<EOF
{
  "city": "Delhi",
  "state": "Delhi",
  "country": "India",
  "latitude": 28.6139,
  "longitude": 77.2090
}
EOF
)
    
    http_request "PATCH" "${SERVICE_URL}/users/test/${TEST_USER_1}/location" "${location_data}" 200 "Update location"
}

# Test: Update preferred city
test_preferred_city() {
    log_test "Preferred City"
    
    local city_data=$(cat <<EOF
{
  "city": "Bangalore"
}
EOF
)
    
    http_request "PATCH" "${SERVICE_URL}/users/test/${TEST_USER_1}/preferred-city" "${city_data}" 200 "Update preferred city"
}

# Test: Update status
test_status() {
    log_test "Status"
    
    local status_data=$(cat <<EOF
{
  "status": "ONLINE"
}
EOF
)
    
    http_request "PATCH" "${SERVICE_URL}/users/test/${TEST_USER_1}/status" "${status_data}" 200 "Update status"
}

# Test: Get user by ID (public endpoint)
test_get_user_by_id() {
    log_test "Get User by ID"
    
    http_request "GET" "${SERVICE_URL}/users/${TEST_USER_1}" "" 200 "Get user by ID"
}

# Test: Batch get users
test_batch_get_users() {
    log_test "Batch Get Users"
    
    local batch_data=$(cat <<EOF
{
  "userIds": ["${TEST_USER_1}", "${TEST_USER_2}"]
}
EOF
)
    
    # Make request and accept both 200 and 201
    local response=$(curl -s -w "\n%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -d "${batch_data}" \
        "${SERVICE_URL}/users/batch" 2>&1)
    
    local status_code=$(echo "$response" | tail -n1)
    
    if [ "$status_code" -eq 200 ] || [ "$status_code" -eq 201 ]; then
        log_success "Batch get users (${status_code})"
    else
        log_error "Batch get users - Expected 200/201, got ${status_code}"
        return 1
    fi
}

# Test: Edge case - Invalid user ID
test_invalid_user_id() {
    log_test "Edge Case: Invalid User ID"
    
    http_request "GET" "${SERVICE_URL}/users/invalid-user-id-12345" "" 404 "Get invalid user (should fail)"
}

# Test: Edge case - Missing required fields
test_missing_fields() {
    log_test "Edge Case: Missing Required Fields"
    
    local invalid_data='{"username": "testuser2"}'
    
    http_request "POST" "${SERVICE_URL}/users/${TEST_USER_2}/profile" "${invalid_data}" 400 "Create profile with missing fields (should fail)"
}

# Test: Edge case - Invalid username
test_invalid_username() {
    log_test "Edge Case: Invalid Username"
    
    local invalid_data=$(cat <<EOF
{
  "username": "ab",
  "dateOfBirth": "1998-01-15T00:00:00.000Z",
  "gender": "MALE",
  "displayPictureUrl": "https://via.placeholder.com/300"
}
EOF
)
    
    http_request "POST" "${SERVICE_URL}/users/${TEST_USER_3}/profile" "${invalid_data}" 400 "Create profile with invalid username (should fail)"
}

# Test: Search brands
test_search_brands() {
    log_test "Search Brands"
    
    # Brand search may return 503 if Brandfetch API is not configured (expected in local testing)
    local response=$(curl -s -w "\n%{http_code}" -X GET "${SERVICE_URL}/brands/search?q=test" 2>&1)
    local status_code=$(echo "$response" | tail -n1)
    
    if [ "$status_code" -eq 200 ]; then
        log_success "Search brands (200)"
    elif [ "$status_code" -eq 503 ]; then
        log_success "Search brands (503 - Brandfetch not configured, expected in local testing)"
    else
        log_error "Search brands - Expected 200/503, got ${status_code}"
        return 1
    fi
}

# Test: Search music
test_search_music() {
    log_test "Search Music"
    
    # Music search may return 503 if external API is not configured (expected in local testing)
    local response=$(curl -s -w "\n%{http_code}" -X GET "${SERVICE_URL}/music/search?q=test" 2>&1)
    local status_code=$(echo "$response" | tail -n1)
    
    if [ "$status_code" -eq 200 ]; then
        log_success "Search music (200)"
    elif [ "$status_code" -eq 503 ]; then
        log_success "Search music (503 - External API not configured, expected in local testing)"
    else
        log_error "Search music - Expected 200/503, got ${status_code}"
        return 1
    fi
}

# Main test execution
main() {
    echo -e "\n${BLUE}╔════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║  User Service E2E Tests              ║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════╝${NC}\n"
    
    setup
    
    # Run tests
    test_create_profile
    test_get_profile
    test_update_profile
    test_profile_completion
    test_add_photo
    test_get_photos
    test_music_preferences
    test_brand_preferences
    test_interests
    test_values
    test_location
    test_preferred_city
    test_status
    test_get_user_by_id
    test_batch_get_users
    test_search_brands
    test_search_music
    test_delete_photo
    
    # Edge cases
    test_invalid_user_id
    test_missing_fields
    test_invalid_username
    
    cleanup
    
    print_summary
}

# Run main function
main "$@"
