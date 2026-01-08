# Backend API - Frontend Integration

## 🚀 Getting Started

**Local Setup:** See `FRONTEND_SETUP.md` for backend setup instructions.

**Base URLs (Development):**
- Auth Service: `http://localhost:3001`
- User Service: `http://localhost:3002`
- Moderation Service: `http://localhost:3003` (called automatically by user-service)
- Wallet Service: `http://localhost:3006`
- Discovery Service: `http://localhost:3004`
- Friend Service: `http://localhost:3007`

All endpoints accept `Content-Type: application/json` and return JSON responses.

---

## Authentication Endpoints

### Google Sign-In

**Endpoint:** `POST /auth/google`

**Request:**
```json
{
  "idToken": "string (JWT from Google Sign-In SDK)",
  "acceptedTerms": true,
  "acceptedTermsVer": "v1.0"
}
```

**Response:**
```json
{
  "accessToken": "string (JWT)",
  "refreshToken": "string (JWT)"
}
```

**SDK:** Get `idToken` from Google Sign-In SDK (`@react-oauth/google` or equivalent)

---

### Facebook/Meta Sign-In

**Endpoint:** `POST /auth/facebook`

**Request:**
```json
{
  "accessToken": "string (from Facebook SDK)",
  "acceptedTerms": true,
  "acceptedTermsVer": "v1.0"
}
```

**Response:**
```json
{
  "accessToken": "string (JWT)",
  "refreshToken": "string (JWT)"
}
```

**SDK:** Get `accessToken` from Facebook Login SDK (`react-facebook-login` or equivalent)

---

### Apple Sign-In

**Endpoint:** `POST /auth/apple`

**Request:**
```json
{
  "identityToken": "string (JWT from Apple Sign-In SDK)",
  "acceptedTerms": true,
  "acceptedTermsVer": "v1.0"
}
```

**Response:**
```json
{
  "accessToken": "string (JWT)",
  "refreshToken": "string (JWT)"
}
```

**SDK:** Get `identityToken` from Apple Sign-In SDK (`@apple/apple-auth` or `AuthenticationServices`)

---

### Phone OTP (Two-Step)

#### Step 1: Send OTP
**Endpoint:** `POST /auth/phone/send-otp`

**Request:**
```json
{
  "phone": "+918073656316"
}
```

**Response:**
```json
{
  "ok": true,
  "message": "OTP sent successfully"
}
```

#### Step 2: Verify OTP
**Endpoint:** `POST /auth/phone/verify`

**Request:**
```json
{
  "phone": "+918073656316",
  "code": "123456",
  "acceptedTerms": true,
  "acceptedTermsVer": "v1.0"
}
```

**Response:**
```json
{
  "accessToken": "string (JWT)",
  "refreshToken": "string (JWT)"
}
```

**Phone Format:** Indian numbers only - `+91[6-9]XXXXXXXXX` (10 digits, first digit 6-9)

---

## Authenticated Endpoints (Auth Service)

All authenticated endpoints require header:
```
Authorization: Bearer {accessToken}
```

### Get User Info

**Endpoint:** `GET http://localhost:3001/me`

**Response:**
```json
{
  "user": {
    "id": "string",
    "email": "string | null",
    "name": "string | null",
    "phone": "string | null",
    "photoUrl": "string | null",
    "acceptedTerms": true,
    "acceptedTermsVer": "string",
    "preferences": {
      "videoEnabled": "boolean",
      "meetMode": "string (location | video | both)",
      "location": {
        "lat": "number",
        "lng": "number"
      } | null
    }
  }
}
```

---

### Update Preferences

**Endpoint:** `PATCH http://localhost:3001/me/preferences`

**Request:**
```json
{
  "videoEnabled": "boolean (optional)",
  "meetMode": "string (optional: location | video | both)",
  "location": {
    "lat": "number",
    "lng": "number"
  } | null (optional)
}
```

**Response:**
```json
{
  "preferences": {
    "videoEnabled": "boolean",
    "meetMode": "string",
    "location": {
      "lat": "number",
      "lng": "number"
    } | null
  }
}
```

---

## User Service Endpoints

### 1. Create User Profile

After user signs up, they need to create their profile:

**Endpoint:** `POST http://localhost:3002/users/:userId/profile`

**Request:**
```json
{
  "username": "johndoe",  // 3-30 chars, alphanumeric + underscore (can be duplicate/common names)
  "dateOfBirth": "2000-01-01T00:00:00Z",  // User must be 18+
  "gender": "MALE",  // MALE | FEMALE | NON_BINARY | PREFER_NOT_TO_SAY
  "displayPictureUrl": "https://your-cdn.com/profile.jpg"  // Photo already uploaded to your CDN
}
```

**Response:**
```json
{
  "user": {
    "id": "string",
    "username": "string",
    "dateOfBirth": "string",
    "gender": "string",
    "displayPictureUrl": "string",
    // ... other fields
  },
  "profileCompletion": {
    "percentage": 45.5,
    "completed": 5,
    "total": 11,
    "details": { ... }
  }
}
```

**Important Notes:**
- `displayPictureUrl` must be uploaded to your CDN/storage first
- Photo will be automatically checked by moderation service
- If photo fails moderation, profile creation will fail

---

### 2. Get User Profile

**Endpoint:** `GET http://localhost:3002/users/:userId` (public)  
**Endpoint:** `GET http://localhost:3002/me` (authenticated, own profile)

**Query Parameters:**
- `fields` (optional): Comma-separated list of fields to return (e.g., `?fields=username,status,photos`)

**Examples:**
```javascript
// Get full profile
GET http://localhost:3002/me

// Get specific fields only (optimized)
GET http://localhost:3002/me?fields=username,status,displayPictureUrl

// Get public user profile
GET http://localhost:3002/users/{userId}?fields=username,photos,brandPreferences
```

**Response (full profile):**
```json
{
  "user": {
    "id": "string",
    "username": "string",
    "dateOfBirth": "string",
    "gender": "string",
    "displayPictureUrl": "string",
    "photos": [...],
    "musicPreference": {...},
    "brandPreferences": [...],
    "interests": [...],
    "values": [...],
    "status": "IDLE",
    "intent": "string",
    "latitude": 0,
    "longitude": 0,
    // ... other fields
  },
  "profileCompletion": {
    "percentage": 75.5,
    "completed": 15,
    "total": 24,
    "details": { ... }
  }
}
```

**Field Selection:**
- Available fields: `username`, `dateOfBirth`, `gender`, `displayPictureUrl`, `status`, `intent`, `photos`, `musicPreference`, `brandPreferences`, `interests`, `values`, etc.
- `id` field is always included automatically
- Use `profileCompletion` in fields to include completion percentage

---

### 3. Update Profile

**Endpoint:** `PATCH http://localhost:3002/me/profile`

**Request:**
```json
{
  "username": "newusername",  // Optional, can be duplicate/common names
  "intent": "Here to meet new people",  // Optional, max 50 chars
  "videoEnabled": false  // Optional
}
```

**Response:**
```json
{
  "user": {
    // Updated user object
  },
  "profileCompletion": {
    // Updated completion percentage
  }
}
```

**Gender Change Rules:**
- Can change **once** from `PREFER_NOT_TO_SAY` to any other value
- Cannot change from any other value
- Cannot change if already changed once

---

### 4. Photo Management

#### Add Photo

**Endpoint:** `POST http://localhost:3002/me/photos`

**Request:**
```json
{
  "url": "https://your-cdn.com/photo.jpg",  // Photo already uploaded to CDN
  "order": 0  // Must be unique: 0, 1, 2, or 3 (max 4 photos)
}
```

**Limit:** Maximum 4 photos (excluding display picture)

#### Get Photos

**Endpoint:** `GET http://localhost:3002/me/photos` (authenticated)  
**Endpoint:** `GET http://localhost:3002/users/:userId/photos` (public)

#### Delete Photo

**Endpoint:** `DELETE http://localhost:3002/me/photos/:photoId`

---

### 5. Music Preference

#### Search for Songs

**Endpoint:** `GET http://localhost:3002/music/search?q={query}&limit={limit}`

**Query Parameters:**
- `q` (required): Search query (song name, artist name, or both)
- `limit` (optional): Number of results to return (1-50, default: 20)

**Response:**
```json
{
  "songs": [
    {
      "name": "Sicko Mode",
      "artist": "Travis Scott",
      "albumArtUrl": "https://i.scdn.co/image/ab67616d0000b273...",
      "spotifyId": "2xLMifQCjDGFmkHkpNLD9h",
      "albumName": "ASTROWORLD",
      "spotifyUrl": "https://open.spotify.com/track/2xLMifQCjDGFmkHkpNLD9h"
    },
    // ... more results
  ]
}
```

**Note:** This endpoint uses Spotify Web API (completely FREE - no payment required). 
The backend needs `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` environment variables.
To get these credentials:
1. Register a free account at https://developer.spotify.com/
2. Create a new app in the Dashboard
3. Copy the Client ID and Client Secret
4. Set them as environment variables

#### Create/Get Music Preference (from search result)

**Endpoint:** `POST http://localhost:3002/music/preferences`

**Request:**
```json
{
  "songName": "Sicko Mode",
  "artistName": "Travis Scott",
  "albumArtUrl": "https://i.scdn.co/image/ab67616d0000b273...",
  "spotifyId": "2xLMifQCjDGFmkHkpNLD9h"
}
```

**Response:**
```json
{
  "song": {
    "id": "song-id",
    "name": "Sicko Mode",
    "artist": "Travis Scott",
    "albumArtUrl": "https://i.scdn.co/image/ab67616d0000b273...",
    "spotifyId": "2xLMifQCjDGFmkHkpNLD9h",
    "createdAt": "2025-01-01T00:00:00Z"
  }
}
```

#### Update Music Preference

**Endpoint:** `PATCH http://localhost:3002/me/music-preference`

**Request:**
```json
{
  "musicPreferenceId": "song-id"
}
```

**Response:**
```json
{
  "user": {
    "id": "user-id",
    "musicPreference": {
      "id": "song-id",
      "name": "Sicko Mode",
      "artist": "Travis Scott",
      "albumArtUrl": "https://i.scdn.co/image/ab67616d0000b273...",
      "spotifyId": "2xLMifQCjDGFmkHkpNLD9h"
    }
  }
}
```

**Complete Flow:**

Here's the step-by-step flow for adding a music preference with album art:

1. **User searches for songs:**
   ```javascript
   GET /music/search?q=sicko mode&limit=20
   ```
   Response includes songs with `albumArtUrl`, `name`, `artist`, `spotifyId`, etc.

2. **Frontend displays results:**
   - Show each song with its album art (`albumArtUrl`)
   - Display song name and artist name
   - User can see visual preview before selecting

3. **User selects a song:**
   - User clicks on a song from the search results
   - Frontend has access to: `name`, `artist`, `albumArtUrl`, `spotifyId`

4. **Frontend creates/gets the song in database:**
   ```javascript
   POST /music/preferences
   {
     "songName": "Sicko Mode",
     "artistName": "Travis Scott",
     "albumArtUrl": "https://i.scdn.co/image/ab67616d0000b273...",
     "spotifyId": "2xLMifQCjDGFmkHkpNLD9h"
   }
   ```
   Response returns the song with its database `id`.

5. **Frontend updates user's music preference:**
   ```javascript
   PATCH /me/music-preference
   Authorization: Bearer {accessToken}
   {
     "musicPreferenceId": "song-id-from-step-4"
   }
   ```
   User's profile now has this song as their music preference.

**Example Frontend Code:**
```javascript
// 1. Search for songs
const searchSongs = async (query) => {
  const response = await fetch(`http://localhost:3002/music/search?q=${encodeURIComponent(query)}`);
  const data = await response.json();
  return data.songs; // Array with albumArtUrl, name, artist, etc.
};

// 2. Display results (React example)
{songs.map(song => (
  <div key={song.spotifyId} onClick={() => selectSong(song)}>
    <img src={song.albumArtUrl} alt={song.name} />
    <p>{song.name}</p>
    <p>{song.artist}</p>
  </div>
))}

// 3. Create song and set as preference
const selectSong = async (song) => {
  // Create/get song in database
  const createResponse = await fetch('http://localhost:3002/music/preferences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      songName: song.name,
      artistName: song.artist,
      albumArtUrl: song.albumArtUrl,
      spotifyId: song.spotifyId
    })
  });
  const { song: createdSong } = await createResponse.json();
  
  // Set as user's music preference
  await fetch('http://localhost:3002/me/music-preference', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      musicPreferenceId: createdSong.id
    })
  });
};
```

**Displaying Music Preference:**
When fetching user profile, the `musicPreference` object includes `albumArtUrl`:
```javascript
GET /me?fields=musicPreference
// Response includes:
{
  "user": {
    "musicPreference": {
      "id": "song-id",
      "name": "Sicko Mode",
      "artist": "Travis Scott",
      "albumArtUrl": "https://i.scdn.co/image/ab67616d0000b273...",
      "spotifyId": "2xLMifQCjDGFmkHkpNLD9h"
    }
  }
}
```
You can display this with the album art, song name, and artist name in your UI.

---

### 6. Brand Preferences

**Endpoint:** `PATCH http://localhost:3002/me/brand-preferences`

**Request:**
```json
{
  "brandIds": ["brand-id-1", "brand-id-2", "brand-id-3", "brand-id-4"]  // Max 5 brands
}
```

---

### 7. Interests

**Endpoint:** `PATCH http://localhost:3002/me/interests`

**Request:**
```json
{
  "interestIds": ["interest-id-1", "interest-id-2", "interest-id-3"]  // Max 4 interests
}
```

---

### 8. Values

**Endpoint:** `PATCH http://localhost:3002/me/values`

**Request:**
```json
{
  "valueIds": ["value-id-1", "value-id-2", "value-id-3", "value-id-4"]  // Max 4 values
}
```

---

### 9. Location (GPS Coordinates)

**Endpoint:** `PATCH http://localhost:3002/me/location`

**Request:**
```json
{
  "latitude": 28.7041,
  "longitude": 77.1025
}
```

**Note:** This endpoint updates GPS coordinates. For location-based matching with preferred cities, use the Discovery Service location endpoints (`/location/preference`). See "Location Feature" section under Discovery Service endpoints.

---

### 9.1 Preferred Cities (Location-Based Matching)

**Note:** Preferred cities are managed through the Discovery Service. See "Location Feature" section under Discovery Service endpoints.

**Summary:**
- **Get preferred city:** `GET http://localhost:3004/location/preference` (requires auth)
- **Update preferred city:** `PATCH http://localhost:3004/location/preference` (requires auth)
- **Get popular cities:** `GET http://localhost:3004/location/cities` (public)
- **Search cities:** `GET http://localhost:3004/location/search?q=mumbai` (public)
- **Locate me:** `POST http://localhost:3004/location/locate-me` (public)

**Business Logic:**
- `null` preferred city = user can connect with anyone from anywhere (default)
- Non-null city = user prefers to connect with people from this city
- Single city only (not multiple cities)
- City is stored as string (exact match for filtering)

---

### 10. User Status

**Endpoint:** `PATCH http://localhost:3002/me/status`

**Request:**
```json
{
  "status": "IDLE"  // IDLE | IN_MATCHMAKING | IN_1V1_CALL | IN_SQUAD | IN_BROADCAST | WATCHING_HMM_TV
}
```

---

### 11. Profile Completion

**Endpoint:** `GET http://localhost:3002/me/profile-completion`

**Response:**
```json
{
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
      "interests": { "filled": 2, "max": 4 },
      "values": { "filled": 1, "max": 4 },
      "intent": true,
      "location": true
    }
  }
}
```

---

### 12. Catalog Endpoints (Public)

#### Get All Brands

**Endpoint:** `GET http://localhost:3002/brands`

**Response:**
```json
{
  "brands": [
    {
      "id": "string",
      "name": "JBL",
      "logoUrl": "https://cdn.example.com/logos/jbl.png",  // May be null
      "createdAt": "2025-01-01T00:00:00Z"
    },
    // ... more brands (sorted alphabetically)
  ]
}
```

**Note:** Brands include `logoUrl` field for displaying logos. In production, these will be populated.

#### Get All Interests

**Endpoint:** `GET http://localhost:3002/interests`

**Response:**
```json
{
  "interests": [
    {
      "id": "string",
      "name": "Music",
      "createdAt": "2025-01-01T00:00:00Z"
    },
    // ... more interests (sorted alphabetically)
  ]
}
```

#### Get All Values

**Endpoint:** `GET http://localhost:3002/values`

**Response:**
```json
{
  "values": [
    {
      "id": "string",
      "name": "Honesty",
      "createdAt": "2025-01-01T00:00:00Z"
    },
    // ... more values (sorted alphabetically)
  ]
}
```

---

### 13. Batch User Lookup

**Endpoint:** `POST http://localhost:3002/users/batch`

**Request:**
```json
{
  "userIds": ["user-id-1", "user-id-2", "user-id-3"]
}
```

**Response:**
```json
{
  "users": [
    // Array of user objects
  ]
}
```

---

### 14. Nearby Users

**Endpoint:** `GET http://localhost:3002/users/nearby?latitude=28.7041&longitude=77.1025&radius=10`

**Query Parameters:**
- `latitude` (required): User's latitude
- `longitude` (required): User's longitude
- `radius` (optional): Search radius in kilometers (default: 10)

**Response:**
```json
{
  "users": [
    // Array of nearby user objects
  ]
}
```

---

## Photo Upload & Moderation Flow

### Overview

When uploading photos (display picture or additional photos), moderation happens automatically:

```
1. User selects photo in frontend
2. Upload photo to your CDN/storage (Cloudflare R2, AWS S3, etc.)
3. Get photo URL from CDN
4. Send URL to user-service (for display picture or additional photos)
5. User-service automatically calls moderation-service
6. Moderation checks:
   - ✅ Contains a human person (not objects/landscapes)
   - ✅ No NSFW content (nudity, adult content)
   - ✅ No violence or offensive content
7. If checks pass → Photo accepted
8. If checks fail → Request rejected with error message
```

### Error Messages

The backend will return specific error messages:

- **No Human Detected:**
  ```
  "Image must contain a human person. Please upload a photo of yourself."
  ```

- **NSFW Content:**
  ```
  "Image contains inappropriate adult content. Please upload a safe, appropriate photo."
  ```

- **Suggestive Content:**
  ```
  "Image contains suggestive content. Please upload a more appropriate photo."
  ```

**Best Practice:** Show these error messages directly to the user so they know what to fix.

**Note:** Frontend should not call moderation service directly. It's called automatically by user-service when photos are uploaded.

---

## Token Management (Auth Service)

### Refresh Access Token

**Endpoint:** `POST /auth/refresh`

**Request:**
```json
{
  "refreshToken": "string (JWT)"
}
```

**Response:**
```json
{
  "accessToken": "string (new JWT)"
}
```

**Token Expiration:**
- Access Token: 15 minutes
- Refresh Token: 30 days

**Flow:**
```
API call → 401 Unauthorized
  ↓
POST /auth/refresh with refreshToken
  ↓
Retry original request with new accessToken
```

---

### Logout

**Endpoint:** `POST /auth/logout`

**Request:**
```json
{
  "refreshToken": "string (JWT)"
}
```

**Response:**
```json
{
  "ok": true
}
```

**Effect:** Invalidates refresh token. User must sign in again.

---

## Complete User Flows

### Signup/Login Flow
```
1. User selects method (Google/Facebook/Apple/Phone)
2. Get OAuth token from provider SDK
3. POST http://localhost:3001/auth/{provider} with token + acceptedTerms
4. Store accessToken + refreshToken
```

### Phone OTP Flow
```
1. User enters phone → POST http://localhost:3001/auth/phone/send-otp
2. User receives SMS OTP
3. User enters OTP → POST http://localhost:3001/auth/phone/verify
4. Receive accessToken + refreshToken
```

### Authenticated Request Flow
```
1. Include: Authorization: Bearer {accessToken}
2. If 401 → POST http://localhost:3001/auth/refresh
3. Retry with new accessToken
```

### Complete Profile Setup Flow
```
1. User signs up (via auth-service)
2. Get userId from JWT token (decode or call /me endpoint)
3. Upload display picture to CDN
4. POST http://localhost:3002/users/{userId}/profile with profile data
   - Moderation check happens automatically
5. (Optional) Add additional photos (max 4)
6. (Optional) Fetch catalog data (brands, interests, values)
7. (Optional) Update preferences (brands, interests, values, music, location, etc.)
```

### Fetching Catalog Data Flow
```
1. GET http://localhost:3002/brands → Display brands in UI (with logos if logoUrl available)
2. GET http://localhost:3002/interests → Display interests in UI
3. GET http://localhost:3002/values → Display values in UI
4. User selects items
5. PATCH http://localhost:3002/me/{brand-preferences|interests|values} with selected IDs
```

---

## Requirements

### Terms & Conditions
All signup endpoints require:
- `acceptedTerms: true` (boolean)
- `acceptedTermsVer: "v1.0"` (string)

### Phone Numbers
- Indian numbers only: `+91[6-9]XXXXXXXXX`
- Must start with `+91`
- 10 digits after, first digit must be 6-9

---

## Error Responses

**Format:**
```json
{
  "statusCode": 400 | 401 | 500,
  "message": "string",
  "error": "Bad Request" | "Unauthorized" | "Internal Server Error"
}
```

**Common Status Codes:**
- `200` - Success
- `201` - Created (resource created successfully)
- `400` - Bad Request (validation error, moderation failure)
- `401` - Unauthorized (invalid/expired token)
- `404` - Not Found (resource doesn't exist)
- `409` - Conflict (resource already exists)
- `500` - Internal Server Error
- `503` - Service Unavailable (moderation service unavailable)

---

## Endpoint Reference

### Auth Service (http://localhost:3001)

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/auth/google` | POST | No | Google signup/login |
| `/auth/facebook` | POST | No | Facebook signup/login |
| `/auth/apple` | POST | No | Apple signup/login |
| `/auth/phone/send-otp` | POST | No | Send OTP |
| `/auth/phone/verify` | POST | No | Verify OTP & signup/login |
| `/me` | GET | Yes | Get user info |
| `/me/preferences` | PATCH | Yes | Update preferences |
| `/me/metrics` | GET | No | Get live meetings count |
| `/auth/refresh` | POST | No | Refresh access token |
| `/auth/logout` | POST | No | Logout user |

### Discovery Service (http://localhost:3004)

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/metrics/meetings` | GET | No | Get live meetings count |
| `/location/cities` | GET | No | Get cities with maximum users |
| `/location/search` | GET | No | Search for cities |
| `/location/locate-me` | POST | No | Get city from GPS coordinates |
| `/location/preference` | GET | Yes | Get user's preferred city |
| `/location/preference` | PATCH | Yes | Update user's preferred city |
| `/gender-filters` | GET | Yes | Get available gender filters |
| `/gender-filters/apply` | POST | Yes | Purchase and activate gender filter |

### Wallet Service (http://localhost:3006)

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/me/balance` | GET | Yes | Get coin balance |
| `/me/transactions/gender-filter` | POST | Yes | Deduct coins for gender filter (internal use) |

### User Service (http://localhost:3002)

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/users/:userId/profile` | POST | No | Create user profile |
| `/users/:userId` | GET | No | Get user profile (public, supports ?fields=...) |
| `/me` | GET | Yes | Get own profile (supports ?fields=...) |
| `/me/profile` | PATCH | Yes | Update profile |
| `/me/profile-completion` | GET | Yes | Get profile completion percentage |
| `/me/photos` | GET | Yes | Get own photos |
| `/me/photos` | POST | Yes | Add photo (max 4) |
| `/me/photos/:photoId` | DELETE | Yes | Delete photo |
| `/users/:userId/photos` | GET | No | Get user photos (public) |
| `/brands` | GET | No | Get all available brands |
| `/interests` | GET | No | Get all available interests |
| `/values` | GET | No | Get all available values |
| `/music/search` | GET | No | Search for songs (requires Spotify API credentials) |
| `/music/preferences` | POST | No | Create/get music preference |
| `/me/music-preference` | PATCH | Yes | Update music preference |
| `/me/brand-preferences` | PATCH | Yes | Update brand preferences (4-5 brands) |
| `/me/interests` | PATCH | Yes | Update interests (max 4) |
| `/me/values` | PATCH | Yes | Update values (max 4) |
| `/me/location` | PATCH | Yes | Update location (lat/lng) |
| `/me/preferred-city` | PATCH | Yes | Update preferred city (internal use) |
| `/metrics/cities` | GET | No | Get cities with max users (internal use) |
| `/me/status` | PATCH | Yes | Update user status |
| `/users/batch` | POST | No | Get multiple users by IDs |
| `/users/nearby` | GET | No | Get nearby users |

### Moderation Service (http://localhost:3003)

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/moderation/check-image` | POST | No | Check image (called by user-service, not directly) |

**Note:** Frontend should not call moderation service directly. It's called automatically by user-service when photos are uploaded.

### Friend Service (http://localhost:3007)

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/me/friends/requests/pending` | GET | Yes | Get incoming friend requests |
| `/me/friends/requests/sent` | GET | Yes | Get outgoing friend requests (paginated) |
| `/me/friends/requests/:requestId/messages` | GET | Yes | Get messages for a request |
| `/me/friends/requests/:requestId/accept` | POST | Yes | Accept friend request |
| `/me/friends/requests/:requestId/reject` | POST | Yes | Reject friend request |
| `/me/friends` | GET | Yes | Get friends list (paginated) |
| `/me/friends/:friendId/unfriend` | POST | Yes | Unfriend a user |
| `/me/friends/:friendId/block` | POST | Yes | Block a user |
| `/me/friends/:friendId/messages` | POST | Yes | Send message to friend (free) |
| `/me/friends/:friendId/messages` | GET | Yes | Get message history (paginated) |
| `/me/friends/:friendId/messages/read` | POST | Yes | Mark messages as read |
| `/me/friends/requests/:requestId/messages` | POST | Yes | Send message to non-friend (10 coins) |

**Note:** Friend requests can ONLY be sent during video calls via "+" button (WebSocket integration via streaming-service). There is no public API endpoint for sending friend requests. See Friend Service section below for details.

---

## Data Types

**Gender Values:**
- `"MALE"`
- `"FEMALE"`
- `"NON_BINARY"`
- `"PREFER_NOT_TO_SAY"`

**User Status Values:**
- `"IDLE"`
- `"IN_MATCHMAKING"`
- `"IN_1V1_CALL"`
- `"IN_SQUAD"`
- `"IN_BROADCAST"`
- `"WATCHING_HMM_TV"`

**Meet Mode Values (Auth Service):**
- `"location"` - Location-based only
- `"video"` - Video calls only
- `"both"` - Both location and video

**Date Format:** ISO 8601 datetime strings

---

## CORS

**Development:** Enabled for `http://localhost:3000` and `http://localhost:5173`

**Production:** Configure `ALLOWED_ORIGINS` environment variable

---

---

## Discovery Service Endpoints

### 1. Location Feature

The location feature allows users to:
- View cities with the most users
- Search for cities
- Get their current city from GPS coordinates
- Set preferred city for location-based matching

#### 1.1 Get Cities with Maximum Users

**Endpoint:** `GET http://localhost:3004/location/cities`

**Query Parameters:**
- `limit` (optional): Number of cities to return (1-100, default: 20)

**Description:** Returns a list of cities sorted by the number of users who have set that city as their preferred city. Useful for showing popular cities on the homepage.

**Response:**
```json
[
  {
    "city": "Mumbai",
    "availableCount": 450
  },
  {
    "city": "Delhi",
    "availableCount": 320
  },
  {
    "city": "Bangalore",
    "availableCount": 280
  }
]
```

**Note:** `availableCount` includes users with any available status:
- `AVAILABLE` - User is available for matching
- `IN_SQUAD_AVAILABLE` - User is in a squad but available
- `IN_BROADCAST_AVAILABLE` - User is in a broadcast but available

**Example Usage:**
```javascript
// Get top 10 cities
const response = await fetch('http://localhost:3004/location/cities?limit=10');
const cities = await response.json();
// cities is an array of { city, availableCount }
// Display cities in UI with available user counts
```

**Note:** This endpoint is public (no authentication required).

---

#### 1.2 Search Cities

**Endpoint:** `GET http://localhost:3004/location/search`

**Query Parameters:**
- `q` (required): Search query (city name, min 1 char, max 100 chars)
- `limit` (optional): Number of results to return (1-100, default: 20)

**Description:** Searches for cities using OpenStreetMap Nominatim API. Returns matching cities with country and state information.

**Response:**
```json
[
  {
    "city": "Mumbai",
    "country": "India",
    "state": "Maharashtra"
  },
  {
    "city": "Mumbai Beach",
    "country": "United States",
    "state": "Florida"
  }
]
```

**Example Usage:**
```javascript
// Search for cities
const response = await fetch(`http://localhost:3004/location/search?q=${encodeURIComponent('mumbai')}&limit=10`);
const cities = await response.json();
// Display search results in UI
```

**Note:** This endpoint is public (no authentication required). Uses OpenStreetMap Nominatim API for city search.

---

#### 1.3 Locate Me (Get City from GPS Coordinates)

**Endpoint:** `POST http://localhost:3004/location/locate-me`

**Request:**
```json
{
  "latitude": 19.0760,
  "longitude": 72.8777
}
```

**Description:** Uses reverse geocoding to get the city name from GPS coordinates. Useful for "Locate Me" button that gets user's current location.

**Response:**
```json
{
  "city": "Mumbai",
  "country": "India",
  "state": "Maharashtra"
}
```

**Example Usage:**
```javascript
// Get user's current location using browser Geolocation API
navigator.geolocation.getCurrentPosition(async (position) => {
  const { latitude, longitude } = position.coords;
  
  // Get city from coordinates
  const response = await fetch('http://localhost:3004/location/locate-me', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ latitude, longitude })
  });
  const { city, country, state } = await response.json();
  // Display: "Mumbai, Maharashtra, India"
});
```

**Note:** This endpoint is public (no authentication required). Uses OpenStreetMap Nominatim API for reverse geocoding.

**Coordinate Validation:**
- `latitude`: -90 to 90
- `longitude`: -180 to 180

---

#### 1.4 Get Preferred City

**Endpoint:** `GET http://localhost:3004/location/preference`

**Headers:**
```
Authorization: Bearer {accessToken}
```

**Description:** Returns the user's currently preferred city. `null` means user can connect with anyone from anywhere (default state).

**Response:**
```json
{
  "city": "Mumbai"
}
```

**Response (no preferred city - default):**
```json
{
  "city": null
}
```

**Example Usage:**
```javascript
// Get user's preferred city
const response = await fetch('http://localhost:3004/location/preference', {
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});
const { city } = await response.json();

if (!city) {
  // User can connect with anyone from anywhere
  console.log('No location preference set');
} else {
  // User prefers this city
  console.log(`Preferred city: ${city}`);
}
```

---

#### 1.5 Update Preferred City

**Endpoint:** `PATCH http://localhost:3004/location/preference`

**Headers:**
```
Authorization: Bearer {accessToken}
Content-Type: application/json
```

**Request:**
```json
{
  "city": "Mumbai"
}
```

**Request (clear preference - allow anyone from anywhere):**
```json
{
  "city": null
}
```

**Description:** Updates the user's preferred city. Users can set one city. `null` clears the preference (user can connect with anyone from anywhere).

**Response:**
```json
{
  "city": "Mumbai"
}
```

**Validation Rules:**
- City name must be at least 1 character and max 100 characters
- `null` is allowed (clears preference)

**Example Usage:**
```javascript
// Set preferred city
const response = await fetch('http://localhost:3004/location/preference', {
  method: 'PATCH',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    city: 'Mumbai'
  })
});
const { city } = await response.json();

// Clear preference (allow anyone from anywhere)
const clearResponse = await fetch('http://localhost:3004/location/preference', {
  method: 'PATCH',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    city: null
  })
});
```

**Business Rules:**
- **`null`:** User can connect with anyone from anywhere (default state)
- **Non-null city:** User prefers to connect with people from this city
- **Single city only:** Users can only set one preferred city at a time
- **City name:** Stored as string (exact match required for filtering)

**Complete Location Flow:**
1. User clicks "Location" button on homepage
2. Frontend shows list of cities: `GET /location/cities?limit=20`
3. User can:
   - **Search for cities:** `GET /location/search?q=mumbai`
   - **Use "Locate Me":** Get GPS → `POST /location/locate-me` with coordinates
   - **Select from popular cities:** Display results from step 2
4. User selects a city and saves: `PATCH /location/preference` with selected city
5. User's preference is stored and used for matching

---

### 2. Get Live Meetings Count

**Endpoint:** `GET http://localhost:3004/metrics/meetings`

**Description:** Returns the count of users currently active and available for meetings. This includes users with statuses: `AVAILABLE`, `IN_SQUAD`, `IN_SQUAD_AVAILABLE`, `IN_BROADCAST`, `IN_BROADCAST_AVAILABLE`.

**Response:**
```json
{
  "liveMeetings": 1250
}
```

**Example Usage:**
```javascript
// Get live meetings count for homepage
const response = await fetch('http://localhost:3004/metrics/meetings');
const { liveMeetings } = await response.json();
// Display: "1,250 meeting now"
```

**Note:** This endpoint is public (no authentication required).

---

### 2. Get Gender Filters

**Endpoint:** `GET http://localhost:3004/gender-filters`

**Headers:**
```
Authorization: Bearer {accessToken}
```

**Description:** Returns available gender filter options based on the user's gender. Users with `PREFER_NOT_TO_SAY` gender can only use the "All Gender" option (default/unfiltered state).

**Response (for MALE/FEMALE users):**
```json
{
  "applicable": true,
  "availableFilters": [
    {
      "gender": "MALE",
      "label": "Guys",
      "cost": 200,
      "screens": 10
    },
    {
      "gender": "FEMALE",
      "label": "Girls",
      "cost": 200,
      "screens": 10
    },
    {
      "gender": "ALL",
      "label": "All Gender",
      "cost": 0,
      "screens": 0
    }
  ],
  "currentPreference": {
    "genders": ["MALE", "FEMALE"],
    "screensRemaining": 5
  },
  "config": {
    "coinsPerScreen": 200,
    "screensPerPurchase": 10
  }
}
```

**Response (for NON_BINARY users):**
```json
{
  "applicable": true,
  "availableFilters": [
    {
      "gender": "MALE",
      "label": "Guys",
      "cost": 200,
      "screens": 10
    },
    {
      "gender": "FEMALE",
      "label": "Girls",
      "cost": 200,
      "screens": 10
    },
    {
      "gender": "NON_BINARY",
      "label": "Nonbinary",
      "cost": 200,
      "screens": 10
    },
    {
      "gender": "ALL",
      "label": "All Gender",
      "cost": 0,
      "screens": 0
    }
  ],
  "config": {
    "coinsPerScreen": 200,
    "screensPerPurchase": 10
  }
}
```

**Response (for PREFER_NOT_TO_SAY users):**
```json
{
  "applicable": true,
  "availableFilters": [
    {
      "gender": "ALL",
      "label": "All Gender",
      "cost": 0,
      "screens": 0
    }
  ],
  "config": {
    "coinsPerScreen": 200,
    "screensPerPurchase": 10
  }
}
```

**Note:** PREFER_NOT_TO_SAY users can only use the "All Gender" option (no filter), which is the default state.

**Business Rules:**
- **MALE/FEMALE users:** Can see and filter by MALE, FEMALE, and "All Gender" (3 options)
- **NON_BINARY users:** Can see and filter by MALE, FEMALE, NON_BINARY, and "All Gender" (4 options)
- **"All Gender" option:** Always available, free (cost: 0), clears filter (default/unfiltered state)
- **PREFER_NOT_TO_SAY users:** Filter is disabled

**Example Usage:**
```javascript
// Get available gender filters
const response = await fetch('http://localhost:3004/gender-filters', {
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});
const data = await response.json();

if (!data.applicable) {
  // Show message: "You need to set your gender to use filters"
  console.log(data.reason);
} else {
  // Display filter options in UI
  data.availableFilters.forEach(filter => {
    console.log(`${filter.label}: ${filter.cost} coins for ${filter.screens} screens`);
  });
  
  // Show current preference if exists
  if (data.currentPreference) {
    console.log(`Currently filtering by: ${data.currentPreference.genders.join(', ')}`);
    console.log(`Screens remaining: ${data.currentPreference.screensRemaining}`);
  }
}
```

---

### 3. Apply Gender Filter

**Endpoint:** `POST http://localhost:3004/gender-filters/apply`

**Headers:**
```
Authorization: Bearer {accessToken}
Content-Type: application/json
```

**Request:**
```json
{
  "genders": ["MALE", "FEMALE"]
}
```

**Request (to clear filter / set to default):**
```json
{
  "genders": ["ALL"]
}
```

**Description:** 
- Purchases and activates gender filter. Deducts coins from wallet and creates/updates filter preference. One payment covers all selected genders (you pay once regardless of how many genders you select).
- **Special case:** Selecting `["ALL"]` clears the filter (no wallet deduction, no storage). This is the default/unfiltered state.

**Response (for paid filters):**
```json
{
  "success": true,
  "screensRemaining": 10,
  "newBalance": 4800
}
```

**Response (for "ALL" - clears filter):**
```json
{
  "success": true
}
```

**Business Rules:**
- Cost: 200 coins per filter (configurable, default: 200)
- Screens per purchase: 10 (configurable, default: 10)
- If user already has a preference, screens are added to existing count
- Selected genders must be valid based on user's gender:
  - MALE/FEMALE users: Can only select MALE or FEMALE (excluding "ALL")
  - NON_BINARY users: Can select any combination (excluding "ALL")
- **"ALL" option:**
  - Free (cost: 0, no wallet deduction)
  - Clears any existing filter preference (no storage)
  - Represents the default/unfiltered state
  - Always available for all users

**Error Responses:**
- `400 Bad Request` - Invalid gender selection or insufficient balance
- `401 Unauthorized` - Missing or invalid token
- `403 Forbidden` - User has PREFER_NOT_TO_SAY gender

**Example Usage:**
```javascript
// Apply gender filter (paid)
const response = await fetch('http://localhost:3004/gender-filters/apply', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    genders: ['MALE', 'FEMALE'] // User selects which genders to filter by
  })
});
const { success, screensRemaining, newBalance } = await response.json();

// Clear filter / set to default (free)
const clearResponse = await fetch('http://localhost:3004/gender-filters/apply', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    genders: ['ALL'] // Clears filter, no cost
  })
});
const { success: clearSuccess } = await clearResponse.json();

if (response.ok) {
  const { screensRemaining, newBalance } = await response.json();
  console.log(`Filter activated! ${screensRemaining} screens remaining`);
  console.log(`New balance: ${newBalance} coins`);
} else {
  const error = await response.json();
  console.error('Failed to apply filter:', error.message);
}
```

**Complete Flow:**
1. User opens filter screen → `GET /gender-filters` to see options
2. User selects genders → `POST /gender-filters/apply` to purchase
3. Coins deducted, filter activated
4. When user views matches, screens are decremented (handled by backend)
5. When screens reach 0, user needs to purchase again

---

## Wallet Service Endpoints

### 1. Get Coin Balance

**Endpoint:** `GET http://localhost:3005/me/balance`

**Headers:**
```
Authorization: Bearer {accessToken}
```

**Response:**
```json
{
  "balance": 25500
}
```

**Description:**
- Returns the current coin balance for the authenticated user
- Wallet is automatically created with 0 balance if it doesn't exist (lazy initialization)
- Balance is always a non-negative integer

**Example Usage:**
```javascript
// Fetch coin balance
const response = await fetch('http://localhost:3005/me/balance', {
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});
const { balance } = await response.json();
// Display balance in UI: balance = 25500
```

**Error Responses:**
- `401 Unauthorized` - Missing or invalid token
- `500 Internal Server Error` - Server configuration error

---

### 2. Deduct Coins for Gender Filter

**Endpoint:** `POST http://localhost:3005/me/transactions/gender-filter`

**Headers:**
```
Authorization: Bearer {accessToken}
Content-Type: application/json
```

**Request:**
```json
{
  "amount": 200,
  "screens": 10
}
```

**Description:** Deducts coins from wallet for gender filter purchase. Creates a transaction record. This endpoint is typically called by discovery-service, not directly by frontend.

**Response:**
```json
{
  "newBalance": 4800,
  "transactionId": "transaction-id-123"
}
```

**Error Responses:**
- `400 Bad Request` - Insufficient balance or invalid amount
- `401 Unauthorized` - Missing or invalid token
- `500 Internal Server Error` - Server error

**Note:** Frontend should use `POST /gender-filters/apply` (discovery-service) instead of calling this endpoint directly. The discovery-service handles the wallet deduction automatically.

---

## Friend Service Endpoints

**Base URL:** `http://localhost:3007`

### Overview

The Friend Service handles friend requests, friendships, and messaging between users.

**Key Features:**
- **In-Call Friend Requests ONLY**: Friend requests can ONLY be sent during video calls via "+" button on participant's video/audio placeholder
- **No Notifications**: When a user sends a friend request, the target user receives NO notification. They will see the request in their "Pending Requests" tab
- **Auto-Accept Mutual Requests**: When both users send requests to each other during a call, both requests are automatically accepted
- **Messaging**:
  - Free messaging between friends
  - Paid messaging to non-friends (10 coins per message)
  - Message persistence and history
  - Read receipts
- **Unlimited Friends**: No maximum friend limit
- **Request Expiration**: Friend requests expire after 30 days

### Authentication

All endpoints require:
```
Authorization: Bearer {accessToken}
```

---

### Friend Requests

#### ⚠️ Important: How Friend Requests Work

**Friend requests can ONLY be sent during video calls** via the "+" button on a participant's video/audio placeholder. There is NO public API endpoint for users to send friend requests directly.

**Flow:**
1. User A and User B are in a video call (streaming-service)
2. User A clicks the "+" button on User B's video/audio placeholder
3. Frontend sends WebSocket message to streaming-service: `send-friend-request`
4. Streaming-service calls friend-service internal endpoint
5. If User B also sent request to User A, both are auto-accepted
6. Otherwise, User B will see the request in their "Pending Requests" tab (no notification)

**WebSocket Integration (via Streaming Service):**

During video calls, send friend requests via WebSocket:

**Message Type:** `send-friend-request`
```json
{
  "type": "send-friend-request",
  "data": {
    "roomId": "string",
    "toUserId": "string"
  }
}
```

**Response:** `friend-request-sent`
```json
{
  "type": "friend-request-sent",
  "data": {
    "roomId": "string",
    "toUserId": "string",
    "requestId": "string",
    "autoAccepted": false
  }
}
```

**If Auto-Accepted (Mutual Request):** `friend-request-accepted`
```json
{
  "type": "friend-request-accepted",
  "data": {
    "roomId": "string",
    "friendId": "string",
    "mutual": true
  }
}
```

**Note:** If the request is pending (not auto-accepted), the target user receives NO notification. They will see the request in their "Pending Requests" tab when they check.

---

#### 1. Get Pending Requests (Incoming)

Get all incoming friend requests that are pending acceptance.

**Endpoint:** `GET /me/friends/requests/pending`

**Response:**
```json
{
  "requests": [
    {
      "id": "string",
      "fromUserId": "string",
      "fromUser": {
        "id": "string",
        "username": "string",
        "displayPictureUrl": "string | null"
      },
      "message": "string | null",
      "createdAt": "2024-01-01T00:00:00Z",
      "expiresAt": "2024-01-31T00:00:00Z"
    }
  ]
}
```

**Example:**
```javascript
const response = await fetch('http://localhost:3007/me/friends/requests/pending', {
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});
const data = await response.json();
// data.requests contains array of pending requests
```

---

#### 2. Get Sent Requests (Outgoing)

Get all friend requests you've sent that are still pending.

**Endpoint:** `GET /me/friends/requests/sent`

**Query Parameters:**
- `limit` (optional): Number of requests to return (default: 50, max: 100)
- `cursor` (optional): Pagination cursor from previous response

**Response:**
```json
{
  "requests": [
    {
      "id": "string",
      "toUserId": "string",
      "toUser": {
        "id": "string",
        "username": "string",
        "displayPictureUrl": "string | null"
      },
      "message": "string | null",
      "createdAt": "2024-01-01T00:00:00Z",
      "expiresAt": "2024-01-31T00:00:00Z"
    }
  ],
  "nextCursor": "string | null",
  "hasMore": false
}
```

**Example (with pagination):**
```javascript
const response = await fetch('http://localhost:3007/me/friends/requests/sent?limit=20&cursor=abc123', {
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});
const data = await response.json();
// Use data.nextCursor for next page if data.hasMore is true
```

---

#### 3. Get Messages for a Request

Get all messages sent with a pending friend request (nudging messages).

**Endpoint:** `GET /me/friends/requests/:requestId/messages`

**Response:**
```json
{
  "messages": [
    {
      "id": "string",
      "fromUserId": "string",
      "toUserId": "string",
      "message": "string",
      "isRead": false,
      "readAt": "2024-01-01T00:00:00Z | null",
      "transactionId": "string | null",
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

**Example:**
```javascript
const response = await fetch(`http://localhost:3007/me/friends/requests/${requestId}/messages`, {
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});
const data = await response.json();
```

---

#### 4. Accept Friend Request

Accept a pending friend request.

**Endpoint:** `POST /me/friends/requests/:requestId/accept`

**Response:**
```json
{
  "ok": true,
  "friendship": {
    "id": "string",
    "friendId": "string",
    "friend": {
      "id": "string",
      "username": "string",
      "displayPictureUrl": "string | null"
    },
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

**Example:**
```javascript
const response = await fetch(`http://localhost:3007/me/friends/requests/${requestId}/accept`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  }
});
const data = await response.json();
```

---

#### 5. Reject Friend Request

Reject a pending friend request.

**Endpoint:** `POST /me/friends/requests/:requestId/reject`

**Response:**
```json
{
  "ok": true
}
```

**Example:**
```javascript
const response = await fetch(`http://localhost:3007/me/friends/requests/${requestId}/reject`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  }
});
```

---

### Friends

#### 6. Get Friends List

Get all friends (accepted friendships).

**Endpoint:** `GET /me/friends`

**Query Parameters:**
- `limit` (optional): Number of friends to return (default: 50, max: 100)
- `cursor` (optional): Pagination cursor from previous response

**Response:**
```json
{
  "friends": [
    {
      "friendId": "string",
      "friend": {
        "id": "string",
        "username": "string",
        "displayPictureUrl": "string | null"
      },
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ],
  "nextCursor": "string | null",
  "hasMore": false
}
```

**Example (with pagination):**
```javascript
const response = await fetch('http://localhost:3007/me/friends?limit=50&cursor=abc123', {
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});
const data = await response.json();
// Use data.nextCursor for next page if data.hasMore is true
```

---

#### 7. Unfriend a User

Remove a friendship (unfriend).

**Endpoint:** `POST /me/friends/:friendId/unfriend`

**Response:**
```json
{
  "ok": true
}
```

**Example:**
```javascript
const response = await fetch(`http://localhost:3007/me/friends/${friendId}/unfriend`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  }
});
```

---

#### 8. Block a User

Block a user (prevents future friend requests and interactions).

**Endpoint:** `POST /me/friends/:friendId/block`

**Response:**
```json
{
  "ok": true
}
```

**Example:**
```javascript
const response = await fetch(`http://localhost:3007/me/friends/${friendId}/block`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  }
});
```

---

### Messaging

#### 9. Send Message to Friend (Free)

Send a message to an accepted friend. This is FREE - no coins deducted.

**Endpoint:** `POST /me/friends/:friendId/messages`

**Request:**
```json
{
  "message": "Hello friend! How are you?"
}
```

**Response:**
```json
{
  "messageId": "string"
}
```

**Example:**
```javascript
const response = await fetch(`http://localhost:3007/me/friends/${friendId}/messages`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    message: "Hello friend! How are you?"
  })
});
const data = await response.json();
```

**Note:** Message must be 1-1000 characters.

---

#### 10. Send Message to Non-Friend (10 Coins)

Send a message to someone who sent you a friend request (nudge them to accept). This costs **10 coins** and will fail if you have insufficient balance.

**Endpoint:** `POST /me/friends/requests/:requestId/messages`

**Request:**
```json
{
  "message": "Hey! Would love to connect with you."
}
```

**Response:**
```json
{
  "messageId": "string",
  "newBalance": 90
}
```

**Error Response (Insufficient Balance):**
```json
{
  "statusCode": 400,
  "message": "Insufficient coins to send message. Required: 10 coins"
}
```

**Example:**
```javascript
const response = await fetch(`http://localhost:3007/me/friends/requests/${requestId}/messages`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    message: "Hey! Would love to connect with you."
  })
});

if (!response.ok) {
  const error = await response.json();
  if (error.message.includes('Insufficient coins')) {
    // Show "Insufficient balance" message to user
  }
}

const data = await response.json();
// data.newBalance shows updated wallet balance
```

**Note:**
- Message must be 1-1000 characters
- Costs 10 coins (deducted automatically from wallet)
- Can only send to users who have sent you a friend request
- Each message costs 10 coins (no daily limits)

---

#### 11. Get Message History

Get message history with a friend.

**Endpoint:** `GET /me/friends/:friendId/messages`

**Query Parameters:**
- `limit` (optional): Number of messages to return (default: 50, max: 100)
- `cursor` (optional): Pagination cursor from previous response

**Response:**
```json
{
  "messages": [
    {
      "id": "string",
      "fromUserId": "string",
      "toUserId": "string",
      "message": "string",
      "isRead": false,
      "readAt": "2024-01-01T00:00:00Z | null",
      "transactionId": "string | null",
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ],
  "nextCursor": "string | null",
  "hasMore": false
}
```

**Note:** Messages are returned in reverse chronological order (newest first). Use `cursor` for pagination.

**Example (with pagination):**
```javascript
const response = await fetch(`http://localhost:3007/me/friends/${friendId}/messages?limit=50&cursor=abc123`, {
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});
const data = await response.json();
// Use data.nextCursor for older messages if data.hasMore is true
```

---

#### 12. Mark Messages as Read

Mark all unread messages from a friend as read.

**Endpoint:** `POST /me/friends/:friendId/messages/read`

**Response:**
```json
{
  "ok": true,
  "markedCount": 5
}
```

**Example:**
```javascript
const response = await fetch(`http://localhost:3007/me/friends/${friendId}/messages/read`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  }
});
const data = await response.json();
// data.markedCount shows how many messages were marked as read
```

---

### Complete Friend Flow Example

**Frontend Implementation:**

```javascript
// 1. During video call - Send friend request via WebSocket
// (Handled by streaming-service WebSocket, see STREAMING_SERVICE_FRONTEND.md)

// 2. Get pending requests (show in "Pending Requests" tab)
async function getPendingRequests(accessToken) {
  const response = await fetch('http://localhost:3007/me/friends/requests/pending', {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  return await response.json();
}

// 3. Accept a friend request
async function acceptFriendRequest(accessToken, requestId) {
  const response = await fetch(`http://localhost:3007/me/friends/requests/${requestId}/accept`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });
  return await response.json();
}

// 4. Get sent requests (show in "Sent Requests" tab)
async function getSentRequests(accessToken, cursor) {
  const url = cursor 
    ? `http://localhost:3007/me/friends/requests/sent?cursor=${cursor}`
    : 'http://localhost:3007/me/friends/requests/sent';
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  return await response.json();
}

// 5. Send message to non-friend (nudge them - costs 10 coins)
async function sendNudgeMessage(accessToken, requestId, message) {
  const response = await fetch(`http://localhost:3007/me/friends/requests/${requestId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ message })
  });
  
  if (!response.ok) {
    const error = await response.json();
    if (error.message.includes('Insufficient coins')) {
      throw new Error('Insufficient balance. You need 10 coins to send this message.');
    }
    throw error;
  }
  
  return await response.json();
}

// 6. Get friends list
async function getFriends(accessToken, cursor) {
  const url = cursor
    ? `http://localhost:3007/me/friends?cursor=${cursor}`
    : 'http://localhost:3007/me/friends';
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  return await response.json();
}

// 7. Send message to friend (free)
async function sendMessageToFriend(accessToken, friendId, message) {
  const response = await fetch(`http://localhost:3007/me/friends/${friendId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ message })
  });
  return await response.json();
}

// 8. Get message history with friend
async function getMessageHistory(accessToken, friendId, cursor) {
  const url = cursor
    ? `http://localhost:3007/me/friends/${friendId}/messages?cursor=${cursor}`
    : `http://localhost:3007/me/friends/${friendId}/messages`;
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  return await response.json();
}

// 9. Mark messages as read
async function markMessagesAsRead(accessToken, friendId) {
  const response = await fetch(`http://localhost:3007/me/friends/${friendId}/messages/read`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });
  return await response.json();
}
```

---

### Friend Service UI Flow

**Three Main Tabs in Friends Page:**

1. **Pending Requests Tab** (Incoming)
   - Show all pending friend requests received
   - Display: User info, optional message, accept/reject buttons
   - Show messages sent with request (nudging messages)

2. **Sent Requests Tab** (Outgoing)
   - Show all friend requests you've sent that are pending
   - Display: User info, option to send nudge message (costs 10 coins)
   - Show messages you've sent (nudging messages)

3. **Friends Tab**
   - Show all accepted friends
   - Display: User info, chat button
   - Support unlimited friends (no limit)

**In-Call Friend Request Flow:**

1. User A and User B are in a video call
2. User A clicks "+" button on User B's video/audio placeholder
3. Frontend sends WebSocket message: `send-friend-request`
4. If User B also sent request to User A:
   - Both requests auto-accepted
   - Both users become friends immediately
   - WebSocket event: `friend-request-accepted` (mutual: true)
5. If only User A sent request:
   - Request is pending
   - User B receives NO notification
   - User B will see request in "Pending Requests" tab when they check

---

## ⚠️ Test Endpoints (DO NOT USE IN PRODUCTION)

**IMPORTANT:** The following endpoints are **FOR TESTING ONLY** and should **NEVER** be used by the frontend application. These endpoints bypass authentication and are only available for backend testing purposes.

### Discovery Service Test Endpoints

**⚠️ DO NOT USE THESE ENDPOINTS IN FRONTEND CODE**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/discovery/test/card` | GET | Get discovery card (bypasses auth) |
| `/discovery/test/raincheck` | POST | Raincheck a user (bypasses auth) |
| `/discovery/test/reset-session` | POST | Reset session (bypasses auth) |
| `/gender-filters/test` | GET | Get gender filters (bypasses auth) |
| `/gender-filters/test/apply` | POST | Apply gender filter (bypasses auth) |
| `/location/test/preference` | GET | Get preferred city (bypasses auth) |
| `/location/test/preference` | PATCH | Update preferred city (bypasses auth) |

**Why these exist:** These endpoints are used by automated test scripts to verify backend functionality without requiring authentication tokens. They accept `userId` as a query parameter or in the request body instead of requiring JWT tokens.

**Frontend should use:** The authenticated endpoints documented above (e.g., `/discovery/card`, `/gender-filters`, `/location/preference`).

---

### User Service Test Endpoints

**⚠️ DO NOT USE THESE ENDPOINTS IN FRONTEND CODE**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/users/test/:userId` | GET | Get user profile (bypasses auth) |
| `/users/test/:userId/profile-completion` | GET | Get profile completion (bypasses auth) |
| `/users/test/:userId/profile` | PATCH | Update profile (bypasses auth) |
| `/users/test/:userId/photos` | GET | Get photos (bypasses auth) |
| `/users/test/:userId/photos` | POST | Add photo (bypasses auth) |
| `/users/test/:userId/photos/:photoId` | DELETE | Delete photo (bypasses auth) |
| `/users/test/:userId/music-preference` | PATCH | Update music preference (bypasses auth) |
| `/users/test/:userId/brand-preferences` | PATCH | Update brand preferences (bypasses auth) |
| `/users/test/:userId/interests` | PATCH | Update interests (bypasses auth) |
| `/users/test/:userId/values` | PATCH | Update values (bypasses auth) |
| `/users/test/:userId/location` | PATCH | Update location (bypasses auth) |
| `/users/test/:userId/preferred-city` | PATCH | Update preferred city (bypasses auth) |
| `/users/test/:userId/status` | PATCH | Update status (bypasses auth) |

**Why these exist:** These endpoints are used by automated test scripts to verify backend functionality without requiring authentication tokens. They accept `userId` directly instead of extracting it from JWT tokens.

**Frontend should use:** The authenticated endpoints documented above (e.g., `/me`, `/me/profile`, `/me/photos`, etc.).

---

### Wallet Service Test Endpoints

**⚠️ DO NOT USE THESE ENDPOINTS IN FRONTEND CODE**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/test/balance` | GET | Get balance (bypasses auth, requires `?userId=xxx`) |
| `/test/transactions/gender-filter` | POST | Deduct coins (bypasses auth, requires `userId` in body) |
| `/test/wallet` | GET | Get wallet with transactions (bypasses auth, requires `?userId=xxx`) |
| `/test/wallet/add-coins` | POST | Add coins (bypasses auth, requires `userId` in body) |

**Why these exist:** These endpoints are used by automated test scripts to verify wallet functionality without requiring authentication tokens. They accept `userId` as a query parameter or in the request body instead of requiring JWT tokens.

**Frontend should use:** The authenticated endpoints documented above (e.g., `/me/balance`).

---

### Moderation Service

**Note:** Moderation service does not have test endpoints because it's already a public service (no authentication required). The `/moderation/check-image` endpoint is public and can be called directly, though in practice it's typically called by user-service automatically.

---

## Support

**Setup:** See `FRONTEND_SETUP.md` for local backend setup

**Questions:** Contact backend team with endpoint name, request payload, and error details

**Key Notes:**
- Username can be duplicate/common names (uniqueness not enforced)
- Field selection (`?fields=`) can optimize API calls by fetching only needed data
- Brand logos: `logoUrl` field is available but may be `null` until production CDN is set up
- Photo moderation happens automatically - frontend just needs to handle error messages
- Gender can only be changed once from `PREFER_NOT_TO_SAY` to any other value
- **Services are independently deployable** - Frontend calls each service directly (auth-service, user-service, wallet-service, discovery-service, friend-service, etc.)
- **Gender Filter:** Users with `PREFER_NOT_TO_SAY` gender can only use the "All Gender" option (default/unfiltered state)
- **Wallet:** Wallet is automatically created with 0 balance when first accessed (lazy initialization)
- **Live Meetings:** Count includes users with statuses: `AVAILABLE`, `IN_SQUAD`, `IN_SQUAD_AVAILABLE`, `IN_BROADCAST`, `IN_BROADCAST_AVAILABLE`
- **Location Feature:**
  - `null` preferred city = user can connect with anyone from anywhere (default state)
  - Non-null preferred city = user prefers to connect with people from that city
  - Single city only (users can set one preferred city at a time)
  - City search and "locate me" use OpenStreetMap Nominatim API (public, no API key required)
  - Popular cities list shows cities sorted by user count (from users who have set preferred city)
- **Friend Requests:**
  - Friend requests can ONLY be sent during video calls via "+" button (no public API endpoint)
  - No notifications sent when friend request is received (user sees in "Pending Requests" tab)
  - Mutual requests (both users send to each other) are auto-accepted
  - Unlimited friends allowed (no maximum limit)
  - Requests expire after 30 days
  - Messages to friends are FREE (unlimited)
  - Messages to non-friends cost 10 coins each (no daily limits)
- **⚠️ Test Endpoints:** Do NOT use any endpoints under `/test/` or `/users/test/` or `/discovery/test/` in production frontend code. These are for backend testing only and bypass authentication.
