# Location Feature Testing Guide

## Overview

This document describes how to test the location feature implementation, which includes:
- Getting cities with maximum users
- Searching for cities
- Reverse geocoding (locate me)
- Managing preferred cities

## Prerequisites

1. **Services Running:**
   - User Service: `http://localhost:3002`
   - Discovery Service: `http://localhost:3004`
   - Auth Service: `http://localhost:3001` (optional, for authenticated tests)

2. **Database Migration:**
   The `preferredCities` field has been added to the User model. If you haven't run the migration yet:
   ```bash
   cd apps/user-service
   npm run prisma:push
   ```

3. **Test Token (for authenticated tests):**
   Create a file `tests/discovery-service/.test-tokens` with a valid access token:
   ```
   eyJhbGciOiJFZERTQSJ9...
   ```
   Or use the existing token file if available.

## Running Tests

### Quick Test
```bash
cd tests/discovery-service
./test-location.sh
```

### Test Coverage

The test script covers:

#### Phase 1: Get Cities with Max Users
- ✅ GET `/location/cities` (default limit)
- ✅ GET `/location/cities?limit=5` (custom limit)
- ✅ GET `/location/cities?limit=invalid` (validation error)

#### Phase 2: Search Cities
- ✅ GET `/location/search?q=mumbai` (search by city name)
- ✅ GET `/location/search?q=delhi` (search by city name)
- ✅ GET `/location/search` (missing query - validation error)
- ✅ GET `/location/search?q=pune&limit=3` (search with limit)

#### Phase 3: Locate Me (Reverse Geocoding)
- ✅ POST `/location/locate-me` (Mumbai coordinates)
- ✅ POST `/location/locate-me` (Delhi coordinates)
- ✅ POST `/location/locate-me` (invalid coordinates - validation error)
- ✅ POST `/location/locate-me` (missing fields - validation error)

#### Phase 4: Preferred Cities (Authenticated)
- ✅ GET `/location/preference` (get current preferred cities)
- ✅ PATCH `/location/preference` (set preferred cities)
- ✅ GET `/location/preference` (verify update)
- ✅ PATCH `/location/preference` (clear cities - empty array)
- ✅ PATCH `/location/preference` (too many cities - validation error)
- ✅ GET `/location/preference` (without token - unauthorized)

#### Phase 5: Integration Test
- ✅ Full flow: Locate me → Search → Set preference → Verify

## Manual Testing

### 1. Get Cities with Max Users

```bash
curl http://localhost:3004/location/cities
curl http://localhost:3004/location/cities?limit=10
```

**Expected Response:**
```json
[
  {
    "city": "Mumbai",
    "userCount": 150,
    "onlineCount": 120,
    "chattingCount": 30
  },
  ...
]
```

### 2. Search Cities

```bash
curl "http://localhost:3004/location/search?q=mumbai"
curl "http://localhost:3004/location/search?q=delhi&limit=5"
```

**Expected Response:**
```json
[
  {
    "city": "Mumbai",
    "country": "India",
    "state": "Maharashtra"
  },
  ...
]
```

### 3. Locate Me (Reverse Geocoding)

```bash
curl -X POST http://localhost:3004/location/locate-me \
  -H "Content-Type: application/json" \
  -d '{"latitude": 19.0760, "longitude": 72.8777}'
```

**Expected Response:**
```json
{
  "city": "Mumbai",
  "country": "India",
  "state": "Maharashtra"
}
```

### 4. Get Preferred Cities

```bash
curl http://localhost:3004/location/preference \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Expected Response:**
```json
{
  "cities": ["Mumbai", "Delhi", "Pune"]
}
```

### 5. Update Preferred Cities

```bash
curl -X PATCH http://localhost:3004/location/preference \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"cities": ["Mumbai", "Delhi", "Pune"]}'
```

**Expected Response:**
```json
{
  "cities": ["Mumbai", "Delhi", "Pune"]
}
```

### 6. Clear Preferred Cities (Connect with Anyone)

```bash
curl -X PATCH http://localhost:3004/location/preference \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"cities": []}'
```

**Expected Response:**
```json
{
  "cities": []
}
```

## Test Scenarios

### Scenario 1: New User Flow
1. User opens app → sees location button
2. User clicks location → sees list of cities with max users
3. User searches for their city → selects it
4. User's preferred cities are updated
5. User can now match with people from that city

### Scenario 2: Locate Me Flow
1. User clicks "Locate me" button
2. App sends user's lat/lng to `/location/locate-me`
3. Backend returns city name
4. User confirms and city is added to preferred cities

### Scenario 3: Default (No Location Preference)
1. User doesn't set any preferred cities (empty array)
2. User can connect with anyone from anywhere
3. This is the default behavior

## Validation Rules

- **Preferred Cities:**
  - Max 10 cities per user
  - Empty array is allowed (default - connect with anyone)
  - City names are case-sensitive strings

- **Search:**
  - Query must be 1-100 characters
  - Limit must be 1-100

- **Locate Me:**
  - Latitude: -90 to 90
  - Longitude: -180 to 180

## Geocoding API

The implementation uses **OpenStreetMap Nominatim API** (free, no API key required):
- Base URL: `https://nominatim.openstreetmap.org`
- Can be overridden with `GEOCODING_API_URL` environment variable
- Requires User-Agent header (automatically set)

## Troubleshooting

### Issue: Cities list is empty
- **Cause:** No users have set preferred cities yet
- **Solution:** Set preferred cities for some test users

### Issue: Search returns no results
- **Cause:** Geocoding API may be rate-limited or unavailable
- **Solution:** Check internet connection, wait a few seconds and retry

### Issue: Locate me fails
- **Cause:** Invalid coordinates or geocoding API issue
- **Solution:** Verify coordinates are valid, check API availability

### Issue: Authentication errors
- **Cause:** Invalid or expired token
- **Solution:** Generate a new token using auth service

## Notes

- The geocoding API (Nominatim) has rate limits. For production, consider:
  - Using a paid geocoding service (Google Maps, Mapbox)
  - Implementing caching for city searches
  - Using a local city database

- City names are stored as-is from the geocoding API. Consider normalizing city names for consistency.

- The "cities with max users" endpoint only shows cities where users have set preferred cities. Users with empty preferred cities are not counted.

