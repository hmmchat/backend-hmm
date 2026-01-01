# Backend API - Frontend Integration

## 🚀 Getting Started

**Local Setup:** See `FRONTEND_SETUP.md` for backend setup instructions.

**Base URLs (Development):**
- Auth Service: `http://localhost:3001`
- User Service: `http://localhost:3002`
- Moderation Service: `http://localhost:3003` (called automatically by user-service)

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

### 9. Location

**Endpoint:** `PATCH http://localhost:3002/me/location`

**Request:**
```json
{
  "latitude": 28.7041,
  "longitude": 77.1025
}
```

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
| `/me/location` | PATCH | Yes | Update location |
| `/me/status` | PATCH | Yes | Update user status |
| `/users/batch` | POST | No | Get multiple users by IDs |
| `/users/nearby` | GET | No | Get nearby users |

### Moderation Service (http://localhost:3003)

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/moderation/check-image` | POST | No | Check image (called by user-service, not directly) |

**Note:** Frontend should not call moderation service directly. It's called automatically by user-service when photos are uploaded.

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

## Support

**Setup:** See `FRONTEND_SETUP.md` for local backend setup

**Questions:** Contact backend team with endpoint name, request payload, and error details

**Key Notes:**
- Username can be duplicate/common names (uniqueness not enforced)
- Field selection (`?fields=`) can optimize API calls by fetching only needed data
- Brand logos: `logoUrl` field is available but may be `null` until production CDN is set up
- Photo moderation happens automatically - frontend just needs to handle error messages
- Gender can only be changed once from `PREFER_NOT_TO_SAY` to any other value
