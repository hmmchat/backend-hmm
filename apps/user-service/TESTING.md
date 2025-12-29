# User Service Testing Guide

Complete guide for testing the user-service API endpoints and functionality.

---

## Prerequisites

Before testing, ensure:

1. ✅ **PostgreSQL is running**
   ```bash
   psql -l
   ```

2. ✅ **Database is created and migrated**
   ```bash
   cd apps/user-service
   npm run prisma:generate
   npm run prisma:migrate
   ```

3. ✅ **Seed data is loaded**
   ```bash
   npm run seed
   ```

4. ✅ **Auth service is running** (port 3001)
   ```bash
   cd apps/auth-service
   npm run start:dev
   ```

5. ✅ **User service is running** (port 3002)
   ```bash
   cd apps/user-service
   npm run start:dev
   ```

---

## Step 1: Get Authentication Token

You need a user ID and access token from auth-service to test authenticated endpoints.

### Option A: Phone OTP Signup (Recommended for Testing)

```bash
# Step 1: Send OTP
curl -X POST http://localhost:3001/auth/phone/send-otp \
  -H "Content-Type: application/json" \
  -d '{"phone": "+918073656316"}'

# Step 2: Verify OTP (replace 123456 with actual OTP received)
curl -X POST http://localhost:3001/auth/phone/verify \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+918073656316",
    "code": "123456",
    "acceptedTerms": true,
    "acceptedTermsVer": "v1.0"
  }'
```

**Response:**
```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ..."
}
```

**Save the `accessToken`** - you'll need it for authenticated requests.

**Get User ID:** Decode the token at [jwt.io](https://jwt.io) or extract from `sub` field.

### Option B: Use Existing User

If you already have a user in auth-service, use that `userId` and get a token via refresh endpoint.

---

## Step 2: Profile Management

### 2.1 Create User Profile

**Endpoint:** `POST /users/:userId/profile`

**Required fields:**
- `username` (unique, 3-30 chars, alphanumeric + underscore)
- `dateOfBirth` (ISO datetime, user must be 18+)
- `gender` (MALE, FEMALE, NON_BINARY, PREFER_NOT_TO_SAY)
- `displayPictureUrl` (valid URL)

**Example:**
```bash
curl -X POST http://localhost:3002/users/YOUR_USER_ID/profile \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser123",
    "dateOfBirth": "2000-01-01T00:00:00Z",
    "gender": "MALE",
    "displayPictureUrl": "https://example.com/profile.jpg"
  }'
```

**Expected Response (200):**
```json
{
  "user": {
    "id": "USER_ID",
    "username": "testuser123",
    "dateOfBirth": "2000-01-01T00:00:00Z",
    "gender": "MALE",
    "displayPictureUrl": "https://example.com/profile.jpg",
    "profileCompleted": true,
    "genderChanged": true,
    "status": "IDLE",
    "videoEnabled": true,
    "createdAt": "...",
    "updatedAt": "..."
  },
  "profileCompletion": {
    "percentage": 50.0,
    "completed": 4,
    "total": 24,
    "details": {
      "required": {
        "username": true,
        "dateOfBirth": true,
        "gender": true,
        "displayPictureUrl": true
      },
      "optional": {
        "photos": { "filled": 0, "max": 4 },
        "musicPreference": false,
        "brandPreferences": { "filled": 0, "max": 5 },
        "interests": { "filled": 0, "max": 4 },
        "values": { "filled": 0, "max": 4 },
        "intent": false,
        "location": false
      }
    }
  }
}
```

**Error Cases:**
- `409 Conflict` - Username already taken
- `400 Bad Request` - User must be at least 18 years old
- `400 Bad Request` - Validation errors (username format, etc.)

---

### 2.2 Get User Profile

**Endpoint:** `GET /users/:userId` (public) or `GET /me` (authenticated)

**Example (Public):**
```bash
curl http://localhost:3002/users/YOUR_USER_ID
```

**Example (Authenticated):**
```bash
curl http://localhost:3002/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Expected Response:**
```json
{
  "user": {
    "id": "USER_ID",
    "username": "testuser123",
    "dateOfBirth": "2000-01-01T00:00:00Z",
    "gender": "MALE",
    "displayPictureUrl": "...",
    "photos": [...],
    "musicPreference": {...},
    "brandPreferences": [...],
    "interests": [...],
    "values": [...],
    ...
  },
  "profileCompletion": {
    "percentage": 50.0,
    "completed": 4,
    "total": 24,
    "details": {
      "required": {
        "username": true,
        "dateOfBirth": true,
        "gender": true,
        "displayPictureUrl": true
      },
      "optional": {
        "photos": { "filled": 0, "max": 4 },
        "musicPreference": false,
        "brandPreferences": { "filled": 0, "max": 5 },
        "interests": { "filled": 0, "max": 4 },
        "values": { "filled": 0, "max": 4 },
        "intent": false,
        "location": false
      }
    }
  }
}
```

---

### 2.3 Get Profile Completion Percentage

**Endpoint:** `GET /me/profile-completion`

**Example:**
```bash
curl http://localhost:3002/me/profile-completion \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Expected Response:**
```json
{
  "profileCompletion": {
    "percentage": 75.5,
    "completed": 15,
    "total": 24,
    "details": {
      "required": {
        "username": true,
        "dateOfBirth": true,
        "gender": true,
        "displayPictureUrl": true
      },
      "optional": {
        "photos": { "filled": 2, "max": 4 },
        "musicPreference": true,
        "brandPreferences": { "filled": 3, "max": 5 },
        "interests": { "filled": 4, "max": 4 },
        "values": { "filled": 2, "max": 4 },
        "intent": true,
        "location": false
      }
    }
  }
}
```

**Scoring Breakdown:**
- **Required fields (50% total):**
  - username: 12.5%
  - dateOfBirth: 12.5%
  - gender: 12.5%
  - displayPictureUrl: 12.5%

- **Optional fields (50% total):**
  - Photos (0-4): 8% (2% per photo)
  - Music preference: 7%
  - Brands (0-5): 10% (2% per brand)
  - Interests (0-4): 10% (2.5% per interest)
  - Values (0-4): 10% (2.5% per value)
  - Intent: 3%
  - Location: 2%

**Note:** The completion percentage is also automatically included in `GET /me` and `GET /users/:userId` responses.

---

### 2.4 Update Profile

**Endpoint:** `PATCH /me/profile`

**Allowed fields:**
- `username` (must be unique)
- `gender` (see gender rules below)
- `intent` (max 50 characters)
- `musicPreferenceId` (string)
- `videoEnabled` (boolean)

**Example:**
```bash
curl -X PATCH http://localhost:3002/me/profile \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "intent": "Here to meet strangers and overthink later",
    "videoEnabled": false
  }'
```

**Gender Change Rules:**
- ✅ Can change **once** from `PREFER_NOT_TO_SAY` to any other value
- ❌ Cannot change from any other value to another
- ❌ Cannot change if already changed once

**Error Cases:**
- `400 Bad Request` - Gender cannot be changed
- `409 Conflict` - Username already taken
- `401 Unauthorized` - Invalid or expired token

---

## Step 3: Photo Management

### 3.1 Add Photo

**Endpoint:** `POST /me/photos`

**Limits:** Maximum 4 photos (excluding display picture)

**Example:**
```bash
curl -X POST http://localhost:3002/me/photos \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/photo1.jpg",
    "order": 0
  }'
```

**Order:** Must be unique (0, 1, 2, or 3)

**Expected Response:**
```json
{
  "photo": {
    "id": "photo_id",
    "userId": "user_id",
    "url": "https://example.com/photo1.jpg",
    "order": 0,
    "createdAt": "..."
  }
}
```

**Error Cases:**
- `400 Bad Request` - Maximum 4 photos allowed
- `409 Conflict` - Photo with order X already exists

---

### 3.2 Get Photos

**Endpoint:** `GET /me/photos` or `GET /users/:userId/photos`

**Example:**
```bash
curl http://localhost:3002/me/photos \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Response:**
```json
{
  "photos": [
    {
      "id": "...",
      "url": "...",
      "order": 0
    },
    ...
  ]
}
```

---

### 3.3 Delete Photo

**Endpoint:** `DELETE /me/photos/:photoId`

**Example:**
```bash
curl -X DELETE http://localhost:3002/me/photos/PHOTO_ID \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Expected Response:**
```json
{
  "ok": true
}
```

---

## Step 4: Music Preference

### 4.1 Create/Get Music Preference

**Endpoint:** `POST /music/preferences`

**Example:**
```bash
curl -X POST http://localhost:3002/music/preferences \
  -H "Content-Type: application/json" \
  -d '{
    "songName": "Sicko Mode",
    "artistName": "Travis Scott",
    "spotifyId": "optional-spotify-id"
  }'
```

**Response:**
```json
{
  "song": {
    "id": "song_id",
    "name": "Sicko Mode",
    "artist": "Travis Scott",
    "spotifyId": null,
    "createdAt": "..."
  }
}
```

**Note:** Save the `song.id` to assign it to your profile.

---

### 4.2 Update Music Preference

**Endpoint:** `PATCH /me/music-preference`

**Example:**
```bash
curl -X PATCH http://localhost:3002/me/music-preference \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"musicPreferenceId": "song_id_from_above"}'
```

---

## Step 5: Brand Preferences

### 5.1 Get Available Brands

First, get list of available brands:

```bash
psql postgres -d hmm_user -c "SELECT id, name FROM brands;"
```

Or query via API (if you add a list endpoint later).

---

### 5.2 Update Brand Preferences

**Endpoint:** `PATCH /me/brand-preferences`

**Limits:** 4-5 brands maximum

**Example:**
```bash
curl -X PATCH http://localhost:3002/me/brand-preferences \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "brandIds": [
      "brand_id_1",
      "brand_id_2",
      "brand_id_3",
      "brand_id_4",
      "brand_id_5"
    ]
  }'
```

**Expected Response:**
```json
{
  "preferences": [
    {
      "id": "...",
      "brand": {
        "id": "...",
        "name": "JBL"
      },
      "order": 0
    },
    ...
  ]
}
```

**Error Cases:**
- `400 Bad Request` - Maximum 5 brands allowed
- `404 Not Found` - One or more brands not found

---

## Step 6: Interests

### 6.1 Get Available Interests

```bash
psql postgres -d hmm_user -c "SELECT id, name FROM interests;"
```

---

### 6.2 Update Interests

**Endpoint:** `PATCH /me/interests`

**Limits:** Maximum 4 interests

**Example:**
```bash
curl -X PATCH http://localhost:3002/me/interests \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "interestIds": [
      "interest_id_1",
      "interest_id_2",
      "interest_id_3",
      "interest_id_4"
    ]
  }'
```

**Error Cases:**
- `400 Bad Request` - Maximum 4 interests allowed
- `404 Not Found` - One or more interests not found

---

## Step 7: Values

### 7.1 Get Available Values

```bash
psql postgres -d hmm_user -c "SELECT id, name FROM values;"
```

---

### 7.2 Update Values

**Endpoint:** `PATCH /me/values`

**Limits:** Maximum 4 values

**Example:**
```bash
curl -X PATCH http://localhost:3002/me/values \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "valueIds": [
      "value_id_1",
      "value_id_2",
      "value_id_3",
      "value_id_4"
    ]
  }'
```

---

## Step 8: Location

### 8.1 Update Location

**Endpoint:** `PATCH /me/location`

**Example:**
```bash
curl -X PATCH http://localhost:3002/me/location \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "latitude": 37.7749,
    "longitude": -122.4194
  }'
```

**Note:** Used for "miles away" calculation in discovery features.

---

## Step 9: User Status

### 9.1 Update Status

**Endpoint:** `PATCH /me/status`

**Valid Statuses:**
- `IDLE`
- `IN_MATCHMAKING`
- `IN_ONE_ON_ONE_CALL`
- `IN_SQUAD`
- `IN_BROADCAST`
- `WATCHING_HMM_TV`

**Example:**
```bash
curl -X PATCH http://localhost:3002/me/status \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "IN_MATCHMAKING"
  }'
```

---

## Step 10: Batch Operations

### 10.1 Get Multiple Users by IDs

**Endpoint:** `POST /users/batch`

**Example:**
```bash
curl -X POST http://localhost:3002/users/batch \
  -H "Content-Type: application/json" \
  -d '{
    "userIds": [
      "user_id_1",
      "user_id_2",
      "user_id_3"
    ]
  }'
```

**Use Case:** Fetch multiple user profiles at once for discovery/matchmaking.

---

### 10.2 Get Nearby Users

**Endpoint:** `GET /users/nearby`

**Query Parameters:**
- `latitude` (required) - User's latitude
- `longitude` (required) - User's longitude
- `radius` (optional, default: 10) - Radius in kilometers
- `limit` (optional, default: 50) - Maximum results

**Example:**
```bash
curl "http://localhost:3002/users/nearby?latitude=37.7749&longitude=-122.4194&radius=10&limit=20"
```

**Response:**
```json
{
  "users": [
    {
      "id": "...",
      "username": "...",
      "distance_km": 2.5,
      ...
    },
    ...
  ]
}
```

---

## Step 11: Validation Testing

### 11.1 Test Username Uniqueness

```bash
# Try creating profile with existing username
curl -X POST http://localhost:3002/users/ANOTHER_USER_ID/profile \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser123",
    "dateOfBirth": "2000-01-01T00:00:00Z",
    "gender": "FEMALE",
    "displayPictureUrl": "https://example.com/photo.jpg"
  }'
```

**Expected:** `409 Conflict` - "Username already taken"

---

### 11.2 Test Age Validation (Under 18)

```bash
curl -X POST http://localhost:3002/users/NEW_USER_ID/profile \
  -H "Content-Type: application/json" \
  -d '{
    "username": "younguser",
    "dateOfBirth": "2010-01-01T00:00:00Z",
    "gender": "MALE",
    "displayPictureUrl": "https://example.com/photo.jpg"
  }'
```

**Expected:** `400 Bad Request` - "User must be at least 18 years old"

---

### 11.3 Test Gender Change Rules

```bash
# Try changing gender from MALE to FEMALE (should fail)
curl -X PATCH http://localhost:3002/me/profile \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"gender": "FEMALE"}'
```

**Expected:** `400 Bad Request` - "Gender cannot be changed. It can only be changed once from 'prefer not to say' to another value."

---

### 11.4 Test Max Photo Limit

```bash
# Add 4 photos first, then try 5th
curl -X POST http://localhost:3002/me/photos \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/photo5.jpg", "order": 4}'
```

**Expected:** `400 Bad Request` - "Maximum 4 photos allowed"

---

### 11.5 Test Max Brand Limit

```bash
# Try adding 6 brands
curl -X PATCH http://localhost:3002/me/brand-preferences \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "brandIds": ["id1", "id2", "id3", "id4", "id5", "id6"]
  }'
```

**Expected:** `400 Bad Request` - "Maximum 5 brands allowed"

---

### 11.6 Test Intent Max Length

```bash
curl -X PATCH http://localhost:3002/me/profile \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "intent": "This is a very long intent message that exceeds 50 characters limit and should fail validation"
  }'
```

**Expected:** `400 Bad Request` - Validation error for max length

---

## Step 12: Profile Completion Percentage Testing

### 12.1 Test Completion Calculation

The profile completion percentage is automatically calculated and included in profile responses. Test it at different stages:

**After creating profile (only required fields):**
```bash
curl http://localhost:3002/me/profile-completion \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Expected:** `percentage: 50.0` (all 4 required fields = 50%)

**After adding photos, music, brands, etc.:**
```bash
# Add photos, music, brands, interests, values, intent, location
# Then check completion again
curl http://localhost:3002/me/profile-completion \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Expected:** Higher percentage (up to 100% when all optional fields are filled)

### 12.2 Test Completion Details

The response shows detailed breakdown:

```bash
curl http://localhost:3002/me/profile-completion \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" | jq '.profileCompletion.details'
```

This shows which fields are filled and which are missing.

### 12.3 Verify Completion Updates

1. Start with profile at 50% (only required fields)
2. Add photos: `percentage` should increase by 2% per photo
3. Add music preference: `percentage` should increase by 7%
4. Add brands: `percentage` should increase by 2% per brand
5. Add interests: `percentage` should increase by 2.5% per interest
6. Add values: `percentage` should increase by 2.5% per value
7. Add intent: `percentage` should increase by 3%
8. Add location: `percentage` should increase by 2%

**Example flow:**
```bash
# Check initial completion (should be ~50%)
curl http://localhost:3002/me/profile-completion \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq '.profileCompletion.percentage'

# Add 2 photos
curl -X POST http://localhost:3002/me/photos \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/photo1.jpg", "order": 0}'

curl -X POST http://localhost:3002/me/photos \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/photo2.jpg", "order": 1}'

# Check completion again (should increase by ~4% = 54%)
curl http://localhost:3002/me/profile-completion \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq '.profileCompletion.percentage'
```

---

## Step 13: Complete Test Flow

Here's a complete end-to-end test flow:

```bash
# Set variables
BASE_URL="http://localhost:3002"
AUTH_URL="http://localhost:3001"

# 1. Sign up and get token (use your actual OTP)
TOKEN_RESPONSE=$(curl -s -X POST $AUTH_URL/auth/phone/verify \
  -H "Content-Type: application/json" \
  -d '{"phone": "+918073656316", "code": "123456", "acceptedTerms": true, "acceptedTermsVer": "v1.0"}')

ACCESS_TOKEN=$(echo $TOKEN_RESPONSE | jq -r '.accessToken')
USER_ID="YOUR_USER_ID"  # Extract from token or use known ID

# 2. Create profile
curl -X POST $BASE_URL/users/$USER_ID/profile \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser'$(date +%s)'",
    "dateOfBirth": "2000-01-01T00:00:00Z",
    "gender": "MALE",
    "displayPictureUrl": "https://example.com/profile.jpg"
  }'

# 3. Get profile
curl $BASE_URL/me -H "Authorization: Bearer $ACCESS_TOKEN"

# 4. Create music preference
SONG_RESPONSE=$(curl -s -X POST $BASE_URL/music/preferences \
  -H "Content-Type: application/json" \
  -d '{"songName": "Sicko Mode", "artistName": "Travis Scott"}')
SONG_ID=$(echo $SONG_RESPONSE | jq -r '.song.id')

# 5. Update music preference
curl -X PATCH $BASE_URL/me/music-preference \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"musicPreferenceId\": \"$SONG_ID\"}"

# 6. Get brand IDs (from database)
BRAND_IDS=$(psql postgres -d hmm_user -t -c "SELECT id FROM brands LIMIT 5;" | tr '\n' ',' | sed 's/,/","/g' | sed 's/^/"/' | sed 's/,"$/"/')

# 7. Update brand preferences
curl -X PATCH $BASE_URL/me/brand-preferences \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"brandIds\": [$BRAND_IDS]}"

# 8. Update location
curl -X PATCH $BASE_URL/me/location \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"latitude": 37.7749, "longitude": -122.4194}'

# 9. Update status
curl -X PATCH $BASE_URL/me/status \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "IN_MATCHMAKING"}'

# 10. Check profile completion percentage
curl $BASE_URL/me/profile-completion \
  -H "Authorization: Bearer $ACCESS_TOKEN"

echo "✅ Complete test flow finished!"
```

---

## Common Issues & Solutions

### 401 Unauthorized

**Problem:** Token expired or invalid

**Solution:**
```bash
# Get new token from auth-service
curl -X POST http://localhost:3001/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken": "YOUR_REFRESH_TOKEN"}'
```

---

### 404 Not Found (User Profile)

**Problem:** User profile doesn't exist

**Solution:** Create profile first:
```bash
curl -X POST http://localhost:3002/users/USER_ID/profile \
  -H "Content-Type: application/json" \
  -d '{...profile data...}'
```

---

### 409 Conflict (Username)

**Problem:** Username already taken

**Solution:** Use a different username or add timestamp:
```json
{"username": "testuser1234567890"}
```

---

### Database Connection Error

**Problem:** Cannot connect to database

**Solution:**
1. Check PostgreSQL is running: `psql -l`
2. Verify `.env` has correct `DATABASE_URL`
3. Check database exists: `psql -l | grep hmm_user`

---

### Port Already in Use

**Problem:** Port 3002 already in use

**Solution:**
```bash
# Find process using port
lsof -i :3002

# Kill process or change PORT in .env
```

---

## API Endpoints Summary

| Method | Endpoint | Auth Required | Description |
|--------|----------|---------------|-------------|
| POST | `/users/:userId/profile` | No | Create user profile |
| GET | `/users/:userId` | No | Get user profile |
| GET | `/me` | Yes | Get current user profile |
| PATCH | `/me/profile` | Yes | Update profile |
| GET | `/me/photos` | Yes | Get user photos |
| POST | `/me/photos` | Yes | Add photo |
| DELETE | `/me/photos/:photoId` | Yes | Delete photo |
| POST | `/music/preferences` | No | Create/get music preference |
| PATCH | `/me/music-preference` | Yes | Update music preference |
| PATCH | `/me/brand-preferences` | Yes | Update brand preferences |
| PATCH | `/me/interests` | Yes | Update interests |
| PATCH | `/me/values` | Yes | Update values |
| PATCH | `/me/location` | Yes | Update location |
| PATCH | `/me/status` | Yes | Update user status |
| POST | `/users/batch` | No | Get multiple users |
| GET | `/users/nearby` | No | Get nearby users |
| GET | `/me/profile-completion` | Yes | Get profile completion percentage |

---

## Next Steps

After testing:

1. ✅ Verify all endpoints work correctly
2. ✅ Test edge cases and validation
3. ✅ Check error handling
4. ✅ Test performance with multiple requests
5. ✅ Integrate with frontend application
6. ✅ Set up monitoring and logging

Happy Testing! 🚀

