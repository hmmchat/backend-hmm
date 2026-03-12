# Frontend Integration Guide

Complete API integration guide for all backend services. This document covers every use case and endpoint you'll need to build the frontend.

## 📚 Table of Contents

1. [Getting Started](#getting-started)
2. [Authentication & User Onboarding](#authentication--user-onboarding)
3. [User Profile Management](#user-profile-management)
4. [Discovery & Matching](#discovery--matching)
5. [Streaming & Video Calls](#streaming--video-calls) — incl. [History](#7-history-call-history-section), [Favourites](#10-favourites-mark-participants--favourite-section)
6. [Friends & Messaging](#friends--messaging)
7. [Wallet & Payments](#wallet--payments)
8. [File Uploads](#file-uploads)
9. [Ads & Rewards](#ads--rewards)
10. [Error Handling](#error-handling)

---

## Getting Started

### Base URLs

**Recommended: Use API Gateway**
- Base URL: `http://localhost:3000`
- All endpoints: `/v1/*`
- Example: `http://localhost:3000/v1/auth/google`

**Alternative: Direct Service Access**
- Auth: `http://localhost:3001`
- User: `http://localhost:3002`
- Discovery: `http://localhost:3004`
- Streaming: `http://localhost:3006` (HTTP and **WebSocket** for video: `ws://localhost:3006/streaming/ws`)
- Wallet: `http://localhost:3005`
- Payment: `http://localhost:3007`
- Friend: `http://localhost:3009`
- Files: `http://localhost:3008`
- Ads: `http://localhost:3010`

**Note:** Video calls use WebSocket to the **streaming service** directly (the API gateway does not proxy WebSockets). Use the streaming service base URL for the WebSocket connection (e.g. `ws://localhost:3006/streaming/ws`).

### Authentication Header

All authenticated endpoints require:
```
Authorization: Bearer {accessToken}
```

### Response Format

All endpoints return JSON:
```json
{
  "success": true,
  "data": { ... }
}
```

Errors:
```json
{
  "statusCode": 400,
  "message": "Error message",
  "error": "Bad Request"
}
```

---

## Authentication & User Onboarding

### 1. Google Sign-In

**Endpoint:** `POST /v1/auth/google`

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

**Frontend Implementation:**
```javascript
import { GoogleLogin } from '@react-oauth/google';

const handleGoogleSignIn = async (credentialResponse) => {
  const response = await fetch('http://localhost:3000/v1/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idToken: credentialResponse.credential,
      acceptedTerms: true,
      acceptedTermsVer: 'v1.0'
    })
  });
  
  const data = await response.json();
  // Store tokens
  localStorage.setItem('accessToken', data.accessToken);
  localStorage.setItem('refreshToken', data.refreshToken);
};
```

### 2. Apple Sign-In

**Endpoint:** `POST /v1/auth/apple`

**Request:**
```json
{
  "identityToken": "string (JWT from Apple Sign-In SDK)",
  "acceptedTerms": true,
  "acceptedTermsVer": "v1.0"
}
```

**Response:** Same as Google (accessToken + refreshToken)

### 3. Facebook Sign-In

**Endpoint:** `POST /v1/auth/facebook`

**Request:**
```json
{
  "accessToken": "string (from Facebook SDK)",
  "acceptedTerms": true,
  "acceptedTermsVer": "v1.0"
}
```

**Response:** Same as Google (accessToken + refreshToken)

### 4. Phone OTP (Two-Step)

#### Step 1: Send OTP

**Endpoint:** `POST /v1/auth/phone/send-otp`

**Request:**
```json
{
  "phone": "+916123456789"
}
```

**Response:**
```json
{
  "ok": true,
  "message": "OTP sent successfully"
}
```

**Phone Format:** Indian numbers only - `+91[6-9]XXXXXXXXX` (10 digits, first digit 6-9)

#### Step 2: Verify OTP

**Endpoint:** `POST /v1/auth/phone/verify`

**Request:**
```json
{
  "phone": "+916123456789",
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

### 5. Refresh Token

**Endpoint:** `POST /v1/auth/refresh`

**Request:**
```json
{
  "refreshToken": "string"
}
```

**Response:**
```json
{
  "accessToken": "string (new JWT)",
  "refreshToken": "string (new JWT)"
}
```

**Use Case:** Call this before access token expires to get new tokens.

### 6. Logout

**Endpoint:** `POST /v1/auth/logout`

**Request:**
```json
{
  "refreshToken": "string"
}
```

**Response:**
```json
{
  "ok": true
}
```

### 7. Get User Info (Auth Service)

**Endpoint:** `GET /auth/me`

**Headers:** `Authorization: Bearer {accessToken}`

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

### 8. Update Preferences (Auth Service)

**Endpoint:** `PATCH /auth/me/preferences`

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

---

## User Profile Management

### 1. Create User Profile

**When:** After user signs up, before they can use the app.

**Endpoint:** `POST /users/:userId/profile`

**Request:**
```json
{
  "username": "johndoe",  // 3-30 chars, alphanumeric + underscore
  "dateOfBirth": "2000-01-01T00:00:00Z",  // User must be 18+
  "gender": "MALE",  // MALE | FEMALE | NON_BINARY | PREFER_NOT_TO_SAY
  "displayPictureUrl": "https://your-cdn.com/profile.jpg"  // Photo URL (upload first)
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

**Important:** 
- Upload photo first using Files Service (see File Uploads section)
- Photo is automatically checked by moderation service
- If photo fails moderation, profile creation fails

### 2. Get User Profile

**Endpoint:** `GET /users/:userId` (public) or `GET /me` (authenticated, own profile)

**Query Parameters:**
- `fields` (optional): Comma-separated list of fields (e.g., `?fields=username,status,photos`)

**Examples:**
```javascript
// Get full profile
GET /me

// Get specific fields only (optimized)
GET /me?fields=username,status,displayPictureUrl

// Get public user profile
GET /users/{userId}?fields=username,photos,brandPreferences
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

### 3. Get Profile Completion

**Endpoint:** `GET /me/profile-completion`

**Response:**
```json
{
  "percentage": 75.5,
  "completed": 15,
  "total": 24,
  "details": {
    "username": true,
    "dateOfBirth": true,
    "gender": true,
    "displayPictureUrl": true,
    "photos": false,
    // ... etc
  }
}
```

### 4. Update Profile

**Endpoint:** `PATCH /me/profile`

**Request:**
```json
{
  "username": "newusername",  // Optional
  "intent": "Here to meet new people",  // Optional, max 50 chars
  "videoEnabled": false  // Optional
}
```

### 5. Photo Management

#### Get Photos

**Endpoint:** `GET /me/photos` (own photos) or `GET /users/:userId/photos` (public)

**Response:**
```json
{
  "photos": [
    {
      "id": "string",
      "url": "string",
      "order": 1,
      "createdAt": "string"
    }
  ]
}
```

#### Add Photo

**Endpoint:** `POST /me/photos`

**Request:**
```json
{
  "url": "https://your-cdn.com/photo.jpg",  // Upload first using Files Service
  "order": 1  // Optional, defaults to next available order
}
```

**Important:** Upload photo first using Files Service, then use the returned URL.

#### Delete Photo

**Endpoint:** `DELETE /me/photos/:photoId`

**Response:**
```json
{
  "ok": true
}
```

### 6. Music Preference

#### Search Songs

**Endpoint:** `GET /music/search?q={query}&limit={limit}`

**Query Parameters:**
- `q` (required): Search query
- `limit` (optional): Results limit (1-50, default 20)

**Response:**
```json
{
  "songs": [
    {
      "id": "string",
      "title": "string",
      "artist": "string",
      "album": "string",
      "artworkUrl": "string",
      "previewUrl": "string"
    }
  ]
}
```

#### Create Music Preference

**Endpoint:** `POST /music/preferences`

**Request:**
```json
{
  "songs": [
    {
      "id": "string",
      "title": "string",
      "artist": "string",
      "album": "string",
      "artworkUrl": "string",
      "previewUrl": "string"
    }
  ]
}
```

#### Update Music Preference

**Endpoint:** `PATCH /me/music-preference`

**Request:** Same as create

### 7. Brand Preferences

#### Get All Brands

**Endpoint:** `GET /brands?limit={limit}`

- Returns a **random selection** of brands to show on the \"Add Brands\" screen.
- `limit` (optional, number): how many brands to return.
  - Default: `8`
  - Min: `1`
  - Max: `50`

**Response:**
```json
{
  "brands": [
    {
      "id": "string",
      "name": "string",
      "logoUrl": "string | null"
    }
  ]
}
```

#### Search Brands

**Endpoint:** `GET /brands/search?q={query}&limit={limit}`

**Response:**
```json
{
  "brands": [
    {
      "id": "string",
      "name": "string",
      "domain": "string | null",
      "logoUrl": "string | null"
    }
  ]
}
```

Search queries the self-managed brand catalog using **intelligent fuzzy matching** on the brand name:
- Case-insensitive
- Tolerant to small spelling mistakes (e.g. `"Adiddas"` → returns `"Adidas"`, `"Nike"`, `"Puma"`, ...)
- Always returns the **closest matches**, even when there is no exact brand with that name

#### Update Brand Preferences

**Endpoint:** `PATCH /me/brand-preferences`

**Request:**
```json
{
  "brandIds": ["brand-id-1", "brand-id-2"]
}
```

### 8. Interests

#### Get All Interests

**Endpoint:** `GET /interests?q={query}&limit={limit}`

- Without `q`:
  - Returns a **random selection** of interests to show on the \"Add Interests\" screen.
  - `limit` (optional, number): how many interests to return (default: `8`, min: `1`, max: `50`).
- With `q`:
  - `GET /interests?q={query}&limit={limit}` performs fuzzy search.
  - `q` (string, required when used): search term typed by the user
  - `limit` (number, optional): max results (default: 20, min: 1, max: 50)
  - Uses the same fuzzy search logic as brands (case-insensitive, typo-tolerant, nearest matches first).

**Response:**
```json
{
  "interests": [
    {
      "id": "string",
      "name": "string",
      "category": "string"
    }
  ]
}
```

#### Update Interests

**Endpoint:** `PATCH /me/interests`

**Request:**
```json
{
  "interestIds": ["interest-id-1", "interest-id-2"]
}
```

### 9. Values

#### Get All Values

**Endpoint:** `GET /values?q={query}&limit={limit}`

- Without `q`:
  - Returns a **random selection** of values to show on the \"Add Values\" screen.
  - `limit` (optional, number): how many values to return (default: `8`, min: `1`, max: `50`).
- With `q`:
  - `GET /values?q={query}&limit={limit}` performs fuzzy search.
  - `q` (string, required when used): search term typed by the user
  - `limit` (number, optional): max results (default: 20, min: 1, max: 50)
  - Uses the same fuzzy search logic as brands (case-insensitive, typo-tolerant, nearest matches first).

**Response:**
```json
{
  "values": [
    {
      "id": "string",
      "name": "string",
      "category": "string"
    }
  ]
}
```

#### Update Values

**Endpoint:** `PATCH /me/values`

**Request:**
```json
{
  "valueIds": ["value-id-1", "value-id-2"]
}
```

### 10. Location & Status

#### Update Location

**Endpoint:** `PATCH /me/location`

**Request:**
```json
{
  "latitude": 19.0760,
  "longitude": 72.8777
}
```

#### Update Status

**Endpoint:** `PATCH /me/status`

**Request:**
```json
{
  "status": "IDLE"  // IDLE | DISCOVERING | IN_SQUAD | IN_CALL
}
```

#### Get Intent by User ID

**Endpoint:** `GET /users/:userId/intent`

**Description:** Get intent for a specific user. This is a public endpoint that can be called from other services.

**Response:**
```json
{
  "intent": "Here to meet new people" | null  // Max 50 chars, null if not set
}
```

**Use Case:** Other services (like discovery-service) can call this to get a user's intent by user ID.

#### Update Intent

**Endpoint:** `PATCH /me/intent`

**Request:**
```json
{
  "intent": "Here to meet new people"  // Max 50 chars, or null to clear intent
}
```

**Response:**
```json
{
  "intent": "Here to meet new people" | null
}
```

**Note:** You can also update intent via `PATCH /me/profile` with `{ "intent": "..." }`, but this dedicated endpoint is more focused.

#### Get Suggested Intent Prompts

**Endpoint:** `GET /intent-prompts?limit={limit}`

**Description:** Returns a random selection of active intent prompts that you can show on the profile creation screen as suggestions. Users can tap one of these **or** type their own custom intent (sent via `PATCH /me/intent` or `PATCH /me/profile`).

**Query Params:**
- `limit` (optional, number): How many prompts to return.  
  - Default: `8`  
  - Min: `1`  
  - Max: `20`

**Response:**
```json
{
  "prompts": [
    {
      "id": "string",
      "text": "Here to meet new people"
    }
  ]
}
```

#### Report User (Universal API)

**Endpoint:** `POST /v1/users/report` (via API Gateway)

**Alternative:** `POST /v1/streaming/users/report` (same request/response; use when already talking to streaming service).

**Description:** Report a user. Use this from any screen (discovery, streaming, face cards, offline cards, etc.). Optional `reportType` maps to a configurable weight on the backend; when a user's total report score exceeds the threshold, they are filtered from discovery.

**Request:**
```json
{
  "reportedUserId": "uuid",
  "reportType": "face_card"   // optional; omit for default weight
}
```

**Report types (optional):** `default`, `face_card`, `offline_card`, `host`, `participant_host`, `participant`. Weights are configurable on the backend; unknown or missing `reportType` uses the default weight.

**Response:**
```json
{
  "success": true,
  "reportCount": 12
}
```

`reportCount` is the reported user's total report score (weighted sum) after this report.

---

## Discovery & Matching

### 1. Get Discovery Card

**Endpoint:** `GET /discovery/card?sessionId={sessionId}&soloOnly={soloOnly}`

**Query Parameters:**
- `sessionId` (optional): Session ID for discovery session
- `soloOnly` (optional, default false): Only show solo users (not in squads)

**Response:**
```json
{
  "card": {
    "userId": "string",
    "username": "string",
    "age": 25,
    "displayPictureUrl": "string",
    "city": "Mumbai",
    "country": "string",
    "intent": "Here to meet new people" | null,  // User's intent (max 50 chars)
    "brands": [
      {
        "name": "string",
        "logoUrl": "string" | undefined
      }
    ],
    "interests": [
      {
        "name": "string"
      }
    ],
    "values": [
      {
        "name": "string"
      }
    ],
    "musicPreference": {
      "name": "string",
      "artist": "string",
      "albumArtUrl": "string" | undefined
    } | undefined,
    "pages": [
      {
        "photoUrl": "string",
        "order": 0
      }
    ],
    "status": "AVAILABLE" | "IN_SQUAD_AVAILABLE" | "IN_BROADCAST_AVAILABLE",
    "reported": false,
    "matchExplanation": {
      "reasons": ["string"],
      "score": 85,
      "commonBrands": ["string"],
      "commonInterests": ["string"],
      "commonValues": ["string"],
      "sameMusic": true,
      "sameCity": false,
      "sameVideoPreference": true
    } | undefined
  },
  "exhausted": false,
  "suggestedCities": [
    {
      "city": "Mumbai",
      "country": "India",
      "availableCount": 25
    }
  ] | undefined,
  "isLocationCard": false
}
```

**Note:** The `intent` field is directly on the `card` object, not nested under a `user` object. This makes it easy to display on the face card.

**Use Case:** Swipe through potential matches. Call this repeatedly to get next cards.

### 2. Raincheck (Pass/Skip)

**Endpoint:** `POST /discovery/raincheck`

**Request:**
```json
{
  "sessionId": "string",
  "raincheckedUserId": "string"
}
```

**Response:**
```json
{
  "success": true,
  "nextCard": { ... }  // Next card automatically returned
}
```

**Use Case:** User swipes left/passes on a card.

### 3. Proceed (Match)

**Endpoint:** `POST /discovery/proceed`

**Request:**
```json
{
  "matchedUserId": "string"
}
```

**Response:**
```json
{
  "success": true
}
```

**Use Case:** User swipes right/likes a card. If both users proceed, they match and enter IN_SQUAD status.

**Important:** After both users proceed:
1. Both users' status changes to `IN_SQUAD`
2. Create a room using Streaming Service (see Streaming section)
3. Users can now video call

### 4. Select Location

**Endpoint:** `POST /discovery/select-location`

**Request:**
```json
{
  "userId": "string",
  "sessionId": "string",
  "city": "Mumbai"
}
```

**Use Case:** User selects a city for discovery.

### 5. Reset Discovery Session

**Endpoint:** `POST /discovery/reset-session`

**Request:**
```json
{
  "userId": "string",
  "sessionId": "string",
  "city": "Mumbai"
}
```

**Use Case:** Reset discovery session to start fresh.

### 6. Get Fallback Cities

**Endpoint:** `GET /discovery/fallback-cities?limit={limit}`

**Response:**
```json
{
  "cities": [
    {
      "name": "Mumbai",
      "state": "Maharashtra",
      "country": "India"
    }
  ]
}
```

**Use Case:** When user has exhausted all matches in current city, show suggested cities.

### 7. Location Services

#### Get Cities

**Endpoint:** `GET /discovery/cities`

**Response:**
```json
{
  "cities": [
    {
      "name": "Mumbai",
      "state": "Maharashtra",
      "country": "India"
    }
  ]
}
```

#### Search Cities

**Endpoint:** `GET /discovery/cities/search?q={query}`

#### Get Location Preference

**Endpoint:** `GET /discovery/location-preference`

**Response:**
```json
{
  "city": "Mumbai",
  "latitude": 19.0760,
  "longitude": 72.8777
}
```

#### Update Location Preference

**Endpoint:** `POST /discovery/location-preference`

**Request:**
```json
{
  "city": "Mumbai",
  "latitude": 19.0760,
  "longitude": 72.8777
}
```

### 8. Gender Filters

#### Get Gender Filter Status

**Endpoint:** `GET /gender-filters`

**Response:**
```json
{
  "availableGenders": ["FEMALE", "MALE", "NON_BINARY"],
  "activeFilters": ["FEMALE"],
  "hasActiveFilter": true
}
```

#### Apply Gender Filter

**Endpoint:** `POST /gender-filters/apply`

**Request:**
```json
{
  "genders": ["FEMALE", "MALE"]
}
```

**Use Case:** User purchases and activates gender filter to see specific genders.

---

## Streaming & Video Calls

Video calls use **Mediasoup** (WebRTC SFU) and **WebSocket** for signaling. The backend does not use Agora.

### 1. Create Room

**Endpoint:** `POST /streaming/rooms` (or `POST /v1/streaming/rooms` via gateway)

**Request:**
```json
{
  "userIds": ["user-id-1", "user-id-2"],  // 2-4 users
  "callType": "matched"  // "matched" | "squad"
}
```

**Response:**
```json
{
  "roomId": "string",
  "sessionId": "string"
}
```

**Use Case:** 
- Called when users match (both proceed) or when creating a squad call
- Store `roomId` and `sessionId`; use `roomId` for the WebSocket video flow below

**Important:** 
- Only users with status `MATCHED` can create rooms (enforced by backend)
- After room creation, join the call via **WebSocket + Mediasoup** (see next section), not a third-party SDK

### 1a. Video Call: WebSocket and Mediasoup

Video is delivered by the backend using **Mediasoup**. Connect to the **streaming service** WebSocket (the API gateway does not proxy WebSockets).

**WebSocket URL:** `ws://localhost:3006/streaming/ws` (direct to streaming service). In production, use your streaming service base URL (e.g. `wss://streaming.yourdomain.com/streaming/ws`).

**Authentication:** Send the JWT in the `Authorization: Bearer <accessToken>` header when opening the WebSocket.

**Flow:**

1. **Open WebSocket** to the streaming service with your access token.
2. **Join room** — send:
   ```json
   { "type": "join-room", "data": { "roomId": "<roomId from create room>" } }
   ```
   Server responds with:
   ```json
   { "type": "room-joined", "data": { "roomId": "...", "rtpCapabilities": { ... } } }
   ```
3. **Create transport** (for sending and receiving) — send:
   ```json
   { "type": "create-transport", "data": { "roomId": "...", "producing": true, "consuming": true } }
   ```
   Server returns transport id and ICE/DTLS parameters; connect it using **mediasoup-client**.
4. **Connect transport** — after the client connects the transport, send:
   ```json
   { "type": "connect-transport", "data": { "roomId": "...", "transportId": "...", "dtlsParameters": { ... } } }
   ```
5. **Produce** (send your audio/video) — send:
   ```json
   { "type": "produce", "data": { "roomId": "...", "transportId": "...", "kind": "video", "rtpParameters": { ... } } }
   ```
   (Repeat for `kind`: `"audio"` if needed.)
6. **Consume** (receive remote tracks) — for each remote producer, send:
   ```json
   { "type": "consume", "data": { "roomId": "...", "transportId": "...", "producerId": "...", "rtpCapabilities": { ... } } }
   ```

Use the **mediasoup-client** library on the frontend to create `Device`, load `rtpCapabilities`, create send/recv transports, and produce/consume tracks. The WebSocket messages above are the signaling protocol the backend expects.

**In-call features (same WebSocket):**
- **Chat:** `{ "type": "chat-message", "data": { "roomId": "...", "message": "Hello!" } }`
- **Leave:** `{ "type": "leave-room", "data": { "roomId": "..." } }`
- **Broadcasting:** `{ "type": "start-broadcast", "data": { "roomId": "..." } }` (host only); viewers use `join-as-viewer`, `create-viewer-transport`, `connect-viewer-transport`, `get-broadcast-producers`, `consume-broadcast`

See `apps/streaming-service/README.md` in the backend repo for the full WebSocket message reference.

### 2. Get Room Info

**Endpoint:** `GET /streaming/rooms/:roomId` (or `GET /v1/streaming/rooms/:roomId` via gateway)

**Response (room exists):**
```json
{
  "exists": true,
  "id": "string",
  "roomId": "string",
  "status": "IN_SQUAD",
  "isBroadcasting": false,
  "participantCount": 2,
  "viewerCount": 0,
  "participants": [
    { "userId": "string", "role": "HOST", "joinedAt": "string" }
  ],
  "viewers": [],
  "createdAt": "string",
  "startedAt": "string"
}
```

**Response (room not found):** `{ "exists": false }`

**Note:** `status` is `IN_SQUAD` (call active) or `IN_BROADCAST` (broadcasting) or `ENDED`. Participant `role` is `HOST` or `PARTICIPANT`.

### 3. Get Chat History

**Endpoint:** `GET /streaming/rooms/:roomId/chat`

**Response:**
```json
{
  "messages": [
    {
      "id": "string",
      "userId": "string",
      "message": "string",
      "timestamp": "string"
    }
  ]
}
```

### 4. Enable Pull Stranger Mode

**Endpoint:** `POST /streaming/rooms/:roomId/enable-pull-stranger`

**Request:**
```json
{
  "userId": "string"  // Must be host
}
```

**Use Case:** Host enables mode to allow strangers to join call.

### 5. Join via Pull Stranger

**Endpoint:** `POST /streaming/rooms/:roomId/join-via-pull-stranger`

**Request:**
```json
{
  "joiningUserId": "string",
  "targetUserId": "string"  // User to join (one-way acceptance)
}
```

**Use Case:** Stranger joins call with specific user (no mutual match required).

### 6. End Call

**Endpoint:** `POST /streaming/rooms/:roomId/end`

**Request:**
```json
{
  "userId": "string"
}
```

**Response:**
```json
{
  "success": true
}
```

**Use Case:** User ends the call. Updates user status back to `IDLE` or `DISCOVERING`.

### 7. History (Call History Section)

**Endpoint:** `GET /v1/streaming/history`

**Headers:** `Authorization: Bearer {accessToken}`

**Query Parameters:**
- `limit` (optional): Number of calls per page (default 20, max 100)
- `cursor` (optional): Pagination cursor from previous response (`nextCursor`)

**Response:**
```json
{
  "calls": [
    {
      "sessionId": "string",
      "roomId": "string",
      "startedAt": "2025-08-25T17:04:00.000Z",
      "endedAt": "2025-08-25T17:36:00.000Z",
      "callType": "Squad",
      "participants": [
        {
          "userId": "string",
          "username": "string | null",
          "displayPictureUrl": "string | null",
          "role": "HOST",
          "userStatus": "SQUAD",
          "location": "Kolkata",
          "durationSeconds": 1928,
          "videoOn": null,
          "isFriend": false,
          "conversationId": "string | null",
          "messageCost": 20
        }
      ]
    }
  ],
  "nextCursor": "2025-08-25T17:04:00.000Z_sessionId",
  "hasMore": false
}
```

**Fields:**
- `callType`: `"Squad"` or `"Broadcast"`
- `userStatus` (per participant): `"SQUAD"` | `"BROADCAST"` | `"DROP_IN"` (joined mid-call)
- `location`: User’s preferred city (e.g. `"Kolkata"`)
- `videoOn`: `null` (not stored today)
- `messageCost`: `0` for friends; coins to message non-friends (e.g. `20`). Use with `conversationId` for Hotline.

**Pagination:**
- `hasMore` is `true` only when `nextCursor` is present. Use `nextCursor` as the `cursor` query param for the next page.
- If `cursor` is missing, invalid, or malformed, the API returns the first page.
- First page: `GET /v1/streaming/history?limit=20`. Next page: `GET /v1/streaming/history?limit=20&cursor={nextCursor}`.

**Use Case:** History list for the History screen. Use `conversationId` and `messageCost` for the **Hotline** button: message via `POST /v1/friends/me/conversations/:conversationId/messages` (see Friends & Messaging).

### 8. Get Call Detail (History Info Icon)

**Endpoint:** `GET /v1/streaming/history/:sessionId`

**Headers:** `Authorization: Bearer {accessToken}`

**Response:** Same shape as a single `calls[]` item (one call with `participants`).

**Use Case:** Extra details for a specific call when user taps the info icon.

### 9. Hide Call from History (Trash Icon)

**Endpoint:** `DELETE /v1/streaming/history/:sessionId`

**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "ok": true
}
```

**Use Case:** Hide a call from the current user’s history. Idempotent.

### 10. Favourites (Mark participants & Favourite section)

A viewer watching a broadcast can mark individual participants as favourites. A **Favourite section** shows all favourited users who are **currently broadcasting** (e.g. a grid of profile pictures with "Beamcasting rn" style). All favourite endpoints require authentication; the gateway sets `x-user-id` when the request is authenticated.

#### Add Favourite (Mark participant as favourite)

**Endpoint:** `POST /v1/streaming/favourites`

**Headers:** `Authorization: Bearer {accessToken}`

**Body:**
```json
{
  "targetUserId": "string"
}
```

**Response:**
```json
{
  "success": true
}
```

**Use Case:** Viewer taps the heart on a participant while watching a broadcast. Idempotent (calling again with the same `targetUserId` is a no-op). Cannot favourite yourself (`targetUserId` must not equal the current user).

#### Remove Favourite

**Endpoint:** `DELETE /v1/streaming/favourites/:targetUserId`

**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "success": true
}
```

**Use Case:** Remove a user from the current user's favourites.

#### Get Favourite Broadcasters (Favourite section list)

**Endpoint:** `GET /v1/streaming/favourites/broadcasting`

**Headers:** `Authorization: Bearer {accessToken}`

**Query Parameters:**
- `limit` (optional): Max number of broadcasts to return (default 20, max 100)

**Response:** Same shape as the active broadcasts list (e.g. `GET /v1/streaming/broadcasts`):
```json
{
  "broadcasts": [
    {
      "roomId": "string",
      "participantCount": 2,
      "viewerCount": 11,
      "participants": [
        {
          "userId": "string",
          "role": "HOST",
          "joinedAt": "2025-08-25T17:04:00.000Z",
          "username": "string | null",
          "displayPictureUrl": "string | null",
          "age": 25
        }
      ],
      "startedAt": "2025-08-25T17:04:00.000Z",
      "createdAt": "2025-08-25T17:04:00.000Z",
      "broadcastTitle": "string | null",
      "broadcastDescription": "string | null",
      "broadcastTags": [],
      "isTrending": false,
      "popularityScore": 0
    }
  ],
  "nextCursor": "string | undefined",
  "hasMore": false
}
```

**Use Case:** When the user opens the "Favourite section" (e.g. from a heart/favourites entry point during a broadcast), call this to show only favourited users who are currently live. Use `roomId` to deep link into the broadcast (same shareable link format: e.g. `/broadcast/:roomId` or `hmm_TV?roomId=...`).

---

## Friends & Messaging

The messaging system is organized into **conversations** with three sections: **INBOX**, **RECEIVED_REQUESTS**, and **SENT_REQUESTS**. Messages can include text, gifts, or both.

**Gateway paths:** When using the API Gateway, prefix all friend endpoints with `/v1/friends` (e.g. `GET /v1/friends/me/conversations/inbox`).

### 🔔 Notification Signal

The notification signal glows green when there are new messages or friend requests in sections the user hasn't viewed yet. When clicked, it redirects users to the appropriate section.

#### Get Notification Counts

**Endpoint:** `GET /v1/friends/me/notifications/count`

**Headers:** `Authorization: Bearer {accessToken}`

**Response:**
```json
{
  "hasNotifications": true,
  "totalUnreadMessages": 5,
  "pendingFriendRequests": 2,
  "breakdown": {
    "inbox": 3,
    "receivedRequests": 2,
    "sentRequests": 0,
    "friendRequests": 2
  }
}
```

**Fields:**
- `hasNotifications`: `true` if there are any unseen notifications (use this to show green glow)
- `totalUnreadMessages`: Total unread messages in unseen sections
- `pendingFriendRequests`: Pending friend requests in unseen section
- `breakdown`: Counts per section (only includes items in sections not yet viewed)

**Seen Tracking Behavior:**
- Sections are automatically marked as "seen" when user navigates to them:
  - `GET /me/conversations/inbox` → marks INBOX as seen
  - `GET /me/conversations/received-requests` → marks RECEIVED_REQUESTS as seen
  - `GET /me/conversations/sent-requests` → marks SENT_REQUESTS as seen
  - `GET /me/friends/requests/pending` → marks FRIEND_REQUESTS as seen
- Notification counts only include items that arrived **after** the section was last seen
- If a section has never been viewed, all items in that section are counted

**Performance & Caching:**
- Results are cached for 30 seconds to reduce database load
- Cache is automatically invalidated when:
  - New messages are sent/received
  - Friend requests are sent/accepted
  - Sections are marked as seen
- Rate limited to 60 requests per 60 seconds per user (configurable via `NOTIFICATION_RATE_LIMIT` env var)

**Frontend Implementation:**
```javascript
// Poll notification counts every 30-60 seconds
const pollNotifications = async () => {
  const response = await fetch('http://localhost:3000/v1/friends/me/notifications/count', {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });
  const data = await response.json();
  
  // Show green glow when hasNotifications is true
  if (data.hasNotifications) {
    showNotificationGlow();
  } else {
    hideNotificationGlow();
  }
  
  // Store breakdown for click handler
  notificationBreakdown = data.breakdown;
};

// Click handler - redirect to appropriate section
const handleNotificationClick = () => {
  if (notificationBreakdown.inbox > 0) {
    // Redirect to INBOX (auto-marks as seen)
    navigate('/conversations/inbox');
  } else if (notificationBreakdown.receivedRequests > 0) {
    // Redirect to RECEIVED (auto-marks as seen)
    navigate('/conversations/received-requests');
  } else if (notificationBreakdown.sentRequests > 0) {
    // Redirect to SENT (auto-marks as seen)
    navigate('/conversations/sent-requests');
  } else if (notificationBreakdown.friendRequests > 0) {
    // Redirect to friend requests (auto-marks as seen)
    navigate('/friends/requests/pending');
  }
};
```

**Scenarios:**
1. **User clicks notification → redirected to INBOX → notification stops glowing** (if no other unseen sections)
2. **User clicks notification → redirected to RECEIVED → notification continues glowing** (if INBOX still has unseen items) → stops only after viewing all sections with notifications

#### Mark Section as Seen (Optional)

**Endpoint:** `POST /v1/friends/me/notifications/mark-seen`

**Headers:** `Authorization: Bearer {accessToken}`

**Request:**
```json
{
  "section": "INBOX" | "RECEIVED_REQUESTS" | "SENT_REQUESTS" | "FRIEND_REQUESTS"
}
```

**Response:**
```json
{
  "ok": true,
  "section": "INBOX",
  "lastSeenAt": "2025-01-28T10:30:00Z"
}
```

**Note:** This endpoint is optional since sections are automatically marked as seen when you call the GET endpoints. Use this only if you need to manually mark a section as seen without fetching its data.

---

### 📋 Conversation Sections Overview

**INBOX:**
- Contains conversations with **friends** (unlimited free messaging)
- Contains **two-sided conversations** (both users have sent messages, even if not friends)
- Messages are **free** for friends
- Auto-promoted when both users send messages

**RECEIVED_REQUESTS:**
- Contains conversations where **you received** a message/request
- First message from them is free (they paid)
- Your first reply is **free**
- Subsequent messages from you require a **gift**

**SENT_REQUESTS:**
- Contains conversations where **you sent** a message/request
- Your first message costs **10 coins** (or gift amount)
- They can reply for **free** (first message back)
- Subsequent text-only messages from you are **not allowed** (must send gift)

### 💰 Message Cost Rules

**Friends (INBOX):**
- ✅ Text messages: **FREE** (unlimited)
- ✅ Gifts: Cost coins (transferred to recipient)
- ✅ Gift + message: Cost coins (gift transferred)

**Non-Friends (SENT_REQUESTS or RECEIVED_REQUESTS):**

**First Message:**
- Text only: **10 coins** (FIRST_MESSAGE_COST_COINS)
- Gift only: Gift amount in coins
- Gift + message: Gift amount in coins

**Subsequent Messages:**
- ❌ Text only: **NOT ALLOWED** (must send gift)
- ✅ Gift only: Gift amount in coins
- ✅ Gift + message: Gift amount in coins

**Recipient's First Reply:**
- ✅ **FREE** (they didn't initiate)

---

### 1. Send Friend Request

**Endpoint:** `POST /me/friends/offline-cards/request`

**Note:** Friend requests can be sent from:
- Offline cards section (this endpoint)
- Video calls (via WebSocket, handled by streaming-service)

**Request:**
```json
{
  "toUserId": "string"
}
```

**Response:**
```json
{
  "ok": true,
  "requestId": "string",
  "autoAccepted": false  // true if mutual request (both users sent)
}
```

**Use Case:** Send friend request when viewing offline cards.

### 2. Get Pending Friend Requests (Incoming)

**Endpoint:** `GET /me/friends/requests/pending`

**Response:**
```json
{
  "requests": [
    {
      "id": "string",
      "fromUserId": "string",
      "message": "string | null",
      "createdAt": "string",
      "expiresAt": "string"
    }
  ]
}
```

### 3. Get Sent Friend Requests (Outgoing)

**Endpoint:** `GET /me/friends/requests/sent`

**Response:**
```json
{
  "requests": [
    {
      "id": "string",
      "toUserId": "string",
      "message": "string | null",
      "createdAt": "string",
      "expiresAt": "string"
    }
  ]
}
```

### 4. Accept Friend Request

**Endpoint:** `POST /me/friends/requests/:requestId/accept`

**Response:**
```json
{
  "ok": true
}
```

**Note:** Conversation automatically moves to INBOX when accepted.

### 5. Reject Friend Request

**Endpoint:** `POST /me/friends/requests/:requestId/reject`

**Response:**
```json
{
  "ok": true
}
```

### 6. Get Friends List

**Endpoint:** `GET /me/friends?limit=50&cursor=xxx`

**Query Parameters:**
- `limit` (optional): Number of friends (default 50, max 100)
- `cursor` (optional): Pagination cursor

**Response:**
```json
{
  "friends": [
    {
      "friendId": "string",
      "createdAt": "string"
    }
  ],
  "nextCursor": "string | undefined",
  "hasMore": false
}
```

### 6a. Get Friends Wall

**Endpoint:** `GET /me/friends/wall?limit=35&cursor=xxx`

**Description:** Get paginated friends with their profile photos for display in a grid layout (friends wall feature).

**Query Parameters:**
- `limit` (optional): Number of photos per page (default: 35, configured via `FRIENDS_WALL_PHOTOS_PER_PAGE` env variable)
- `cursor` (optional): Pagination cursor for next page

**Response:**
```json
{
  "friends": [
    {
      "friendId": "string",
      "photoUrl": "https://cdn.example.com/photo.jpg" | null,
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ],
  "nextCursor": "string | undefined",
  "hasMore": true | false,
  "pageSize": 35
}
```

**Use Case:** Display friends' profile photos in a grid layout (like the reference screenshot showing 35 photos per page).

**Frontend Implementation:**
```javascript
const fetchFriendsWall = async (cursor) => {
  const url = new URL('http://localhost:3000/v1/friends/me/friends/wall');
  if (cursor) url.searchParams.set('cursor', cursor);
  // limit is optional - uses default 35 if not provided
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });
  
  const data = await response.json();
  
  // Handle empty friends list
  if (data.friends.length === 0) {
    // Show empty state
    return;
  }
  
  // Display friends in grid
  data.friends.forEach(friend => {
    // friend.photoUrl can be null - show placeholder if null
    const photoUrl = friend.photoUrl || '/placeholder-avatar.png';
    // Render friend photo in grid
  });
  
  // Pagination
  if (data.hasMore && data.nextCursor) {
    // Load next page with data.nextCursor
    fetchFriendsWall(data.nextCursor);
  }
  
  return data;
};
```

**Notes:**
- `photoUrl` can be `null` if friend doesn't have a profile photo - show placeholder image
- Default page size is 35, but can be customized via `limit` query parameter
- Use `nextCursor` for pagination to load next page
- `hasMore` indicates if there are more friends to load
- `pageSize` shows the current page size used (useful for UI display)

### 8. Share Friends Wall

**Endpoint:** `POST /me/friends/wall/share`

**Description:** Generates a static JPEG image of the user's friend wall that can be shared on Instagram or WhatsApp statuses. The image is cached to avoid regenerating the same wall multiple times.

**Request:**
- No body required
- Requires authentication header

**Response:**
```json
{
  "imageUrl": "https://r2.hmmchat.live/files/friends-wall-share/{userId}/{timestamp}.jpg",
  "deepLink": "https://r2.hmmchat.live/files/friends-wall-share/{userId}/{timestamp}.jpg",
  "productLink": "https://hmmchat.live"
}
```

**Note:** `deepLink` and `imageUrl` are the same - both point directly to the public R2 URL. When anyone clicks the deep link, their browser will directly display or download the JPEG image.

**Frontend Implementation:**
```javascript
const shareFriendsWall = async () => {
  try {
    // Show loading state
    setLoading(true);
    
    const response = await fetch('http://localhost:3000/v1/friends/me/friends/wall/share', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    if (!response.ok) {
      throw new Error('Failed to generate share image');
    }
    
    const data = await response.json();
    
    // Use native sharing API or custom share sheet
    if (navigator.share) {
      await navigator.share({
        title: 'My Friend Wall',
        text: 'Check out my friend wall!',
        url: data.deepLink
      });
    } else {
      // Fallback: Copy link to clipboard or show share options
      await navigator.clipboard.writeText(data.deepLink);
      alert('Link copied to clipboard!');
    }
    
    // For Instagram/WhatsApp: Download image and use their sharing APIs
    // The imageUrl can be downloaded and shared directly
    
    return data;
  } catch (error) {
    console.error('Error sharing friend wall:', error);
    // Show error message to user
  } finally {
    setLoading(false);
  }
};
```

**Error Handling:**
- `429 Too Many Requests`: Rate limit exceeded (10 requests per minute)
- `500 Internal Server Error`: Image generation failed (retryable)
- `503 Service Unavailable`: Files service unavailable

**Rate Limiting:**
- 10 requests per 60 seconds per user
- Rate limit headers included in response:
  - `X-RateLimit-Limit`: Maximum requests allowed
  - `X-RateLimit-Remaining`: Remaining requests in window
  - `X-RateLimit-Reset`: Timestamp when limit resets

**Performance:**
- Image generation takes 5-10 seconds
- Generated images are cached for 24 hours (or until friend list changes)
- Subsequent requests for the same friend wall return cached image immediately

**Deep Link Behavior:**
- When anyone clicks the `deepLink`, the browser directly displays/downloads the JPEG image
- No redirect or intermediate page - direct image access
- Works on all platforms (web, mobile browsers, social media apps)
- Image is publicly accessible (no authentication required)

---

### 7. Get Inbox Conversations

**Endpoint:** `GET /me/conversations/inbox?limit=50&cursor=xxx`

**Query Parameters:**
- `limit` (optional): Number of conversations (default 50, max 100)
- `cursor` (optional): Pagination cursor

**Response:**
```json
{
  "conversations": [
    {
      "id": "string",
      "otherUserId": "string",
      "section": "INBOX",
      "isFriend": true,
      "unreadCount": 2,
      "userStatus": "online" | "offline" | "broadcasting",
      "isBroadcasting": false,
      "broadcastRoomId": "string | null",
      "broadcastUrl": "string | null",
      "lastMessage": {
        "id": "string",
        "fromUserId": "string",
        "message": "string | null",
        "messageType": "TEXT" | "GIFT" | "GIFT_WITH_MESSAGE",
        "giftId": "string | null",
        "giftAmount": "number | null",
        "createdAt": "string"
      },
      "lastMessageAt": "string",
      "createdAt": "string"
    }
  ],
  "nextCursor": "string | undefined",
  "hasMore": false
}
```

**Sorting Behavior:**
- Conversations are sorted by `lastMessageAt` in descending order (newest messages first)
- Conversations without messages are sorted by `createdAt` in descending order (newest conversations first)
- Sorting is consistent across all sections (INBOX, RECEIVED_REQUESTS, SENT_REQUESTS)

**Unread Message Indicators:**
- Use `unreadCount` field to display unread message badges/indicators on conversation items
- When `unreadCount > 0`, show a badge with the count or highlight the conversation
- Example: Show "2" badge or bold conversation title when `unreadCount: 2`

**Use Case:** Display main inbox with friends and two-sided conversations.

### 8. Get Received Requests Conversations

**Endpoint:** `GET /me/conversations/received-requests?limit=50&cursor=xxx&filter=text_only|with_gift|only_follows`

**Query Parameters:**
- `limit` (optional, default: 50, max: 100): Number of conversations to return
- `cursor` (optional): Pagination cursor from previous response
- `filter` (optional): Filter conversations by type
  - `text_only`: Only conversations with TEXT messages (excludes conversations with `lastMessage: null`)
  - `with_gift`: Only conversations with GIFT or GIFT_WITH_MESSAGE types (excludes conversations with `lastMessage: null`)
  - `only_follows`: Only friend requests without any messages (returns special format, see below)

**Response:** Same format as inbox conversations, but `section: "RECEIVED_REQUESTS"`

**Special Response Format for `only_follows` filter:**
When using `filter=only_follows`, the response includes friend requests that have no messages. These items have:
- `id: "follow_{requestId}"` (prefixed with "follow_")
- `lastMessage: null`
- `isFollowRequest: true`
- `followRequestId: "{requestId}"` (the original friend request ID)
- All other fields match the standard conversation format

**Notes:**
- Filters are only available for `RECEIVED_REQUESTS` and `SENT_REQUESTS` sections (not for `INBOX`)
- Conversations with `lastMessage: null` are automatically excluded from `text_only` and `with_gift` filters
- When using `only_follows`, the `cursor` parameter should use the `follow_{requestId}` format if provided from a previous response

**Example Requests:**
```
GET /me/conversations/received-requests?limit=50&filter=text_only
GET /me/conversations/received-requests?limit=50&filter=with_gift&cursor=abc123
GET /me/conversations/received-requests?limit=50&filter=only_follows&cursor=follow_xyz789
```

**Sorting Behavior:**
- Conversations are sorted by `lastMessageAt` in descending order (newest messages first)
- Conversations without messages are sorted by `createdAt` in descending order (newest conversations first)
- Sorting is consistent across all sections (INBOX, RECEIVED_REQUESTS, SENT_REQUESTS)

**Unread Message Indicators:**
- Use `unreadCount` field to display unread message badges/indicators on conversation items
- When `unreadCount > 0`, show a badge with the count or highlight the conversation
- Example: Show "2" badge or bold conversation title when `unreadCount: 2`

**Use Case:** Display conversations where someone messaged you, with optional filtering.

### 9. Get Sent Requests Conversations

**Endpoint:** `GET /me/conversations/sent-requests?limit=50&cursor=xxx&filter=text_only|with_gift|only_follows`

**Query Parameters:**
- `limit` (optional, default: 50, max: 100): Number of conversations to return
- `cursor` (optional): Pagination cursor from previous response
- `filter` (optional): Filter conversations by type
  - `text_only`: Only conversations with TEXT messages (excludes conversations with `lastMessage: null`)
  - `with_gift`: Only conversations with GIFT or GIFT_WITH_MESSAGE types (excludes conversations with `lastMessage: null`)
  - `only_follows`: Only friend requests without any messages (returns special format, see below)

**Response:** Same format as inbox conversations, but `section: "SENT_REQUESTS"`

**Special Response Format for `only_follows` filter:**
When using `filter=only_follows`, the response includes friend requests that have no messages. These items have:
- `id: "follow_{requestId}"` (prefixed with "follow_")
- `lastMessage: null`
- `isFollowRequest: true`
- `followRequestId: "{requestId}"` (the original friend request ID)
- All other fields match the standard conversation format

**Notes:**
- Filters are only available for `RECEIVED_REQUESTS` and `SENT_REQUESTS` sections (not for `INBOX`)
- Conversations with `lastMessage: null` are automatically excluded from `text_only` and `with_gift` filters
- When using `only_follows`, the `cursor` parameter should use the `follow_{requestId}` format if provided from a previous response

**Example Requests:**
```
GET /me/conversations/sent-requests?limit=50&filter=text_only
GET /me/conversations/sent-requests?limit=50&filter=with_gift&cursor=abc123
GET /me/conversations/sent-requests?limit=50&filter=only_follows&cursor=follow_xyz789
```

**Sorting Behavior:**
- Conversations are sorted by `lastMessageAt` in descending order (newest messages first)
- Conversations without messages are sorted by `createdAt` in descending order (newest conversations first)
- Sorting is consistent across all sections (INBOX, RECEIVED_REQUESTS, SENT_REQUESTS)

**Unread Message Indicators:**
- Use `unreadCount` field to display unread message badges/indicators on conversation items
- When `unreadCount > 0`, show a badge with the count or highlight the conversation
- Example: Show "2" badge or bold conversation title when `unreadCount: 2`

**Use Case:** Display conversations where you messaged someone, with optional filtering.

---

### 10. Send Message to Friend (Free)

**Endpoint:** `POST /me/friends/:friendId/messages`

**Request:**
```json
{
  "message": "Hello!" | null,  // Optional if sending gift
  "giftId": "string",  // Optional
  "giftAmount": 100  // Required if giftId provided
}
```

**Response:**
```json
{
  "messageId": "string",
  "newBalance": 900  // Updated balance if gift sent
}
```

**Note:** 
- Text messages are **FREE** for friends
- Gifts cost coins (transferred to friend)
- Either `message` or `giftId` must be provided

### 11. Send Message to Non-Friend (Costs Coins)

**Endpoint:** `POST /me/friends/requests/:requestId/messages`

**Request:**
```json
{
  "message": "Hello!" | null,  // Optional if sending gift
  "giftId": "string",  // Optional
  "giftAmount": 100  // Required if giftId provided
}
```

**Response:**
```json
{
  "messageId": "string",
  "newBalance": 890,  // Updated balance
  "promotedToInbox": false  // true if conversation moved to INBOX
}
```

**Cost Rules:**
- **First message:** 10 coins (text only) OR gift amount
- **Subsequent messages:** Gift required (text-only not allowed)
- **Recipient's first reply:** FREE

**Note:** Conversation automatically moves to INBOX when both users send messages.

### 12. Send Message via Conversation ID (Unified)

**Endpoint:** `POST /me/conversations/:conversationId/messages`

**Request:**
```json
{
  "message": "Hello!" | null,
  "giftId": "string",
  "giftAmount": 100
}
```

**Response:**
```json
{
  "messageId": "string",
  "newBalance": 900,
  "promotedToInbox": false
}
```

**Use Case:** Unified endpoint that automatically routes to friend or non-friend messaging based on conversation.

---

### 13. Get Messages for a Conversation

**Endpoint:** `GET /me/conversations/:conversationId/messages?limit=50&cursor=xxx`

**Query Parameters:**
- `limit` (optional): Number of messages (default 50, max 100)
- `cursor` (optional): Pagination cursor

**Response:**
```json
{
  "messages": [
    {
      "id": "string",
      "fromUserId": "string",
      "toUserId": "string",
      "message": "string | null",
      "isRead": false,
      "readAt": "string | null",
      "transactionId": "string | null",  // Shows if message cost coins
      "giftId": "string | null",
      "giftAmount": "number | null",
      "messageType": "TEXT" | "GIFT" | "GIFT_WITH_MESSAGE",
      "createdAt": "string"
    }
  ],
  "nextCursor": "string | undefined",
  "hasMore": false
}
```

**Displaying Unread Messages:**
- Each message includes an `isRead` boolean field
- **Unread messages** (`isRead: false`): Display in **bold** font weight (like other messaging apps)
- **Read messages** (`isRead: true`): Display in normal font weight
- Use `readAt` timestamp if you need to show when a message was read

**Implementation Example:**
```javascript
// In your message component
const messageStyle = {
  fontWeight: message.isRead ? 'normal' : 'bold'
};

// Render message
<div style={messageStyle}>
  {message.message}
</div>
```

**Best Practices:**
1. When user opens a conversation, call `POST /me/friends/:friendId/messages/read` to mark all messages as read
2. Update local state to set `isRead: true` for all messages after marking as read
3. Refresh conversation list to update `unreadCount` after marking messages as read

### 14. Get Messages with Friend (Legacy)

**Endpoint:** `GET /me/friends/:friendId/messages?limit=50&cursor=xxx`

**Response:** Same format as conversation messages

### 15. Get Messages for Pending Request

**Endpoint:** `GET /me/friends/requests/:requestId/messages`

**Response:** Same format as conversation messages

**Use Case:** View messages in a pending friend request conversation.

---

### 16. Mark Messages as Read

**Endpoint:** `POST /me/friends/:friendId/messages/read`

**Response:**
```json
{
  "ok": true
}
```

**Note:** 
- Marks all unread messages from that friend as read
- Updates `isRead: true` and sets `readAt` timestamp for all unread messages
- After calling this endpoint:
  1. Refresh the conversation list to update `unreadCount` (should become 0)
  2. Update local message state to reflect `isRead: true` for all messages
  3. Remove bold styling from messages in the UI

**When to Call:**
- When user opens/clicks on a conversation
- When user views messages in a conversation
- Optionally: When message is visible in viewport (for auto-read feature)

---

### 17. Unfriend

**Endpoint:** `POST /me/friends/:friendId/unfriend`

**Response:**
```json
{
  "ok": true
}
```

**Note:** Conversation remains in INBOX but `isFriend` becomes `false`.

### 18. Block User

**Endpoint:** `POST /me/friends/:friendId/block`

**Response:**
```json
{
  "ok": true
}
```

**Note:** Blocks user, removes friendship, and prevents messaging.

---

## Unread Messages Implementation Guide

### Overview
The API provides two levels of unread message tracking:
1. **Conversation Level**: `unreadCount` - Total number of unread messages in a conversation
2. **Message Level**: `isRead` - Individual message read status

### Conversation List Display

**Using `unreadCount` field:**
- Show badge/indicator when `unreadCount > 0`
- Display the count number (e.g., "3" badge)
- Highlight or bold the conversation title
- Sort conversations with unreads to the top (optional, backend already sorts by latest message)

**Example UI:**
```
[Badge: 3] John Doe
Latest message preview...
```

### Individual Message Display

**Using `isRead` field:**
- `isRead: false` → Display message in **bold** font
- `isRead: true` → Display message in normal font
- This matches standard messaging app behavior (WhatsApp, iMessage, etc.)

**Implementation:**
```javascript
// React/React Native example
const MessageBubble = ({ message, currentUserId }) => {
  const isFromMe = message.fromUserId === currentUserId;
  const isUnread = !message.isRead && !isFromMe; // Only show bold for received unread messages
  
  return (
    <div style={{ fontWeight: isUnread ? 'bold' : 'normal' }}>
      {message.message}
    </div>
  );
};
```

### Marking Messages as Read

**Endpoint:** `POST /me/friends/:friendId/messages/read`

**When to call:**
1. User opens a conversation
2. User scrolls to view messages
3. Message becomes visible in viewport (optional auto-read)

**After marking as read:**
1. Call the endpoint
2. Update local state: Set all messages `isRead: true`
3. Refresh conversation list to update `unreadCount`
4. Update UI: Remove bold styling from messages

### Complete Flow Example

```javascript
// 1. Fetch conversations (shows unreadCount)
const conversations = await fetch('/me/conversations/inbox');
// conversations[0].unreadCount = 2

// 2. User clicks conversation
const messages = await fetch(`/me/conversations/${conversationId}/messages`);
// messages[0].isRead = false (show in bold)
// messages[1].isRead = false (show in bold)

// 3. Mark as read when user views
await fetch(`/me/friends/${friendId}/messages/read`, { method: 'POST' });

// 4. Update local state
messages.forEach(msg => msg.isRead = true);

// 5. Refresh conversation list
const updatedConversations = await fetch('/me/conversations/inbox');
// updatedConversations[0].unreadCount = 0
```

### Notes
- `unreadCount` only counts messages received by the current user (from `otherUserId`)
- Messages sent by the current user are always considered "read" from their perspective
- The backend automatically updates `unreadCount` when messages are marked as read
- Sorting is handled by the backend (newest messages first)

---

### 🔄 Conversation Promotion Flow

Conversations automatically move between sections:

```
SENT_REQUESTS → INBOX (when recipient replies)
RECEIVED_REQUESTS → INBOX (when you reply)
Any section → INBOX (when friendship is accepted)
```

**Promotion triggers:**
1. Both users send messages → Two-sided conversation → INBOX
2. Friend request accepted → INBOX
3. Mutual friend requests → Auto-accepted → INBOX

---

### 📱 Frontend Implementation Tips

**1. Display Conversations by Section:**
```javascript
// Get all three sections
const [inbox, received, sent] = await Promise.all([
  fetch('/me/conversations/inbox'),
  fetch('/me/conversations/received-requests'),
  fetch('/me/conversations/sent-requests')
]);
```

**2. Check Message Cost Before Sending:**
```javascript
// Check if user is friend
if (conversation.isFriend) {
  // Free messaging
} else if (conversation.section === 'SENT_REQUESTS') {
  // Check if first message or need gift
  const messageCount = await getMessageCount(conversationId);
  if (messageCount > 0 && !giftId) {
    // Show error: "Subsequent messages require a gift"
  }
}
```

**3. Handle Conversation Promotion:**
```javascript
// After sending message, check if promoted
const response = await sendMessage(conversationId, message);
if (response.promotedToInbox) {
  // Move conversation to INBOX tab
  // Show notification: "Conversation moved to inbox"
}
```

**4. Display User Status:**
```javascript
// Show broadcast indicator
if (conversation.isBroadcasting) {
  // Show "Live" badge
  // Link to broadcast: conversation.broadcastUrl
}
```

**5. Message Types:**
```javascript
// Handle different message types
switch (message.messageType) {
  case 'TEXT':
    // Display text only
    break;
  case 'GIFT':
    // Display gift animation
    break;
  case 'GIFT_WITH_MESSAGE':
    // Display gift + text
    break;
}
```

---

## Wallet & Payments

### 1. Get Wallet Balance

**Endpoint:** `GET /me/balance`

**Response:**
```json
{
  "balance": 1000,  // Coins
  "userId": "string"
}
```

### 2. Get Transaction History

**Endpoint:** `GET /me/transactions`

**Query Parameters:**
- `limit` (optional): Number of transactions
- `type` (optional): Filter by type

**Response:**
```json
{
  "transactions": [
    {
      "id": "string",
      "type": "EARNED" | "SPENT" | "PURCHASED",
      "amount": 100,
      "description": "string",
      "createdAt": "string"
    }
  ]
}
```

### 3. Purchase Coins

#### Initiate Purchase

**Endpoint:** `POST /v1/payments/purchase/initiate`

**Request:**
```json
{
  "amountInr": 100,
  "productId": "coins_100"  // Optional
}
```

**Response:**
```json
{
  "orderId": "string",
  "amount": 100,
  "currency": "INR",
  "razorpayOrderId": "string",
  "razorpayKey": "string"  // Use this for Razorpay checkout
}
```

**Use Case:** 
1. Call this to create order
2. Use `razorpayOrderId` and `razorpayKey` with Razorpay SDK
3. Complete payment on frontend
4. Call verify endpoint

#### Verify Purchase

**Endpoint:** `POST /v1/payments/purchase/verify`

**Request:**
```json
{
  "orderId": "string",
  "razorpayPaymentId": "string",
  "razorpaySignature": "string"
}
```

**Response:**
```json
{
  "success": true,
  "coinsAdded": 100,
  "newBalance": 1100
}
```

### 4. Redemption (Diamonds to INR)

#### Preview Redemption

**Endpoint:** `POST /v1/payments/redemption/preview`

**Request:**
```json
{
  "diamonds": 1000
}
```

**Response:**
```json
{
  "diamonds": 1000,
  "estimatedInr": 100,
  "fees": 5,
  "netAmount": 95
}
```

#### Initiate Redemption

**Endpoint:** `POST /v1/payments/redemption/initiate`

**Request:**
```json
{
  "diamonds": 1000,
  "bankAccount": {
    "accountNumber": "string",
    "ifsc": "string",
    "accountHolderName": "string"
  }
}
```

**Response:**
```json
{
  "requestId": "string",
  "status": "PENDING",
  "estimatedInr": 100
}
```

#### Get Redemption Requests

**Endpoint:** `GET /v1/payments/redemption/requests`

**Response:**
```json
{
  "requests": [
    {
      "id": "string",
      "diamonds": 1000,
      "inr": 100,
      "status": "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED",
      "createdAt": "string"
    }
  ]
}
```

---

## Ads & Rewards

Rewarded video ads allow users to earn coins by watching ads. Use the API Gateway base URL.

### 1. Verify Ad Completion & Award Coins

**Endpoint:** `POST /v1/ads/me/ads/reward/verify`

**Headers:** `Authorization: Bearer {accessToken}`

**Request:**
```json
{
  "adUnitId": "string (required)",
  "adNetwork": "string (optional)"
}
```

**Response:**
```json
{
  "success": true,
  "coinsAwarded": 10,
  "newBalance": 1010,
  "transactionId": "string"
}
```

**Use Case:** Call after user completes a rewarded video ad. The backend validates and credits coins. Enforces cooldown and daily limits.

**Errors:**
- `400` - Ad rewards disabled
- `403` - Cooldown period; wait before next ad
- `400` - Daily limit reached

### 2. Get Ad Reward History

**Endpoint:** `GET /v1/ads/me/ads/reward/history?limit=50&offset=0`

**Headers:** `Authorization: Bearer {accessToken}`

**Query Parameters:**
- `limit` (optional): 1-100, default 50
- `offset` (optional): Pagination offset, default 0

### 3. Get Reward Config (Public)

**Endpoint:** `GET /v1/ads/ads/reward/config`

**Response:**
```json
{
  "coinsPerAd": 10,
  "isActive": true,
  "minCooldown": 60,
  "maxAdsPerDay": 10
}
```

**Use Case:** Display "Watch ad for X coins" and cooldown info in the UI.

---

## File Uploads

File uploads work through **both** the API Gateway and direct service access. Use the gateway for consistency with other endpoints; use direct access if you need to bypass the gateway (e.g., for very large uploads).

- **Via API Gateway:** `POST /v1/files/upload` → `http://localhost:3000/v1/files/upload`
- **Direct (Files Service):** `POST /files/upload` → `http://localhost:3008/files/upload`

### 1. Upload File

**Endpoint:** `POST /v1/files/upload` (gateway) or `POST /files/upload` (direct to files service on port 3008)

**Content-Type:** `multipart/form-data`

**Form Data:**
- `file`: File to upload
- `folder` (optional): Folder path
- `processImage` (optional, default true): Process/resize image
- `maxWidth` (optional): Max width for image
- `maxHeight` (optional): Max height for image
- `quality` (optional): Image quality (1-100)

**Response:**
```json
{
  "success": true,
  "file": {
    "id": "string",
    "url": "https://your-cdn.com/file.jpg",
    "filename": "file.jpg",
    "mimeType": "image/jpeg",
    "size": 1024,
    "folder": "string",
    "createdAt": "string"
  }
}
```

**Use Case:** 
- Upload profile pictures
- Upload photos for profile
- Upload any other files

**Frontend Implementation:**
```javascript
const uploadFile = async (file, useGateway = true) => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('folder', 'profile-pictures');
  formData.append('processImage', 'true');
  formData.append('maxWidth', '800');
  formData.append('maxHeight', '800');

  // Use API Gateway (recommended) or direct files service
  const url = useGateway
    ? 'http://localhost:3000/v1/files/upload'
    : 'http://localhost:3008/files/upload';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`
    },
    body: formData
  });

  const data = await response.json();
  return data.file.url;  // Use this URL in profile creation
};
```

### 2. Get Presigned URL (Direct Upload)

**Endpoint:** `POST /files/presigned-url`

**Request:**
```json
{
  "filename": "photo.jpg",
  "mimeType": "image/jpeg",
  "folder": "profile-pictures",
  "expiresIn": 3600  // Optional, seconds
}
```

**Response:**
```json
{
  "success": true,
  "url": "https://presigned-url...",
  "key": "string",
  "expiresAt": "string"
}
```

**Use Case:** Get presigned URL for direct upload to Cloudflare R2 (bypasses backend).

### 3. Get User Files

**Endpoint:** `GET /v1/files/me/files` (gateway) or `GET /me/files` (direct to files service on port 3008)

**Query Parameters:**
- `limit` (optional): Number of files

**Response:**
```json
{
  "files": [
    {
      "id": "string",
      "url": "string",
      "filename": "string",
      "mimeType": "string",
      "size": 1024,
      "createdAt": "string"
    }
  ]
}
```

### 4. Delete File

**Endpoint:** `DELETE /files/:fileId`

**Response:**
```json
{
  "success": true
}
```

---

## Error Handling

### HTTP Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request (validation error)
- `401` - Unauthorized (missing/invalid token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `409` - Conflict (e.g., duplicate username)
- `422` - Unprocessable Entity (business logic error)
- `500` - Internal Server Error
- `503` - Service Unavailable (external service down)

### Error Response Format

```json
{
  "statusCode": 400,
  "message": "Validation error message",
  "error": "Bad Request"
}
```

### Common Errors

**1. Missing Token**
```json
{
  "statusCode": 401,
  "message": "Missing token",
  "error": "Unauthorized"
}
```
**Solution:** Include `Authorization: Bearer {token}` header

**2. Invalid Token**
```json
{
  "statusCode": 401,
  "message": "Invalid token",
  "error": "Unauthorized"
}
```
**Solution:** Refresh token or re-authenticate

**3. Validation Error**
```json
{
  "statusCode": 400,
  "message": "Username must be 3-30 characters",
  "error": "Bad Request"
}
```
**Solution:** Fix request data according to validation rules

**4. User Not Found**
```json
{
  "statusCode": 404,
  "message": "User not found",
  "error": "Not Found"
}
```
**Solution:** Check user ID is correct

### Retry Logic

For transient errors (500, 503), implement exponential backoff:

```javascript
const retryRequest = async (fn, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
    }
  }
};
```

---

## Best Practices

### 1. Token Management

- Store `accessToken` and `refreshToken` securely
- Refresh token before it expires
- Handle token refresh automatically
- Clear tokens on logout

### 2. Error Handling

- Always check response status
- Display user-friendly error messages
- Log errors for debugging
- Implement retry logic for transient errors

### 3. File Uploads

- Upload files before creating/updating profile
- Show upload progress
- Handle upload failures gracefully
- Validate file size and type on frontend

### 4. State Management

- Cache user profile data
- Update local state after API calls
- Sync state across components
- Handle offline scenarios

### 5. Performance

- Use field selection for large objects
- Implement pagination for lists
- Cache frequently accessed data
- Lazy load non-critical data

### 6. Conversation Management

- **Load all three sections** on app start (INBOX, RECEIVED_REQUESTS, SENT_REQUESTS)
- **Handle conversation promotion** - Move conversations between tabs when `promotedToInbox: true`
- **Check message costs** before sending:
  - Friends: Always free
  - Non-friends: First message costs 10 coins, subsequent require gift
- **Display user status** - Show online/offline/broadcasting indicators
- **Handle broadcast links** - Use `broadcastUrl` for deep linking to live broadcasts
- **Update unread counts** - Refresh after marking messages as read
- **Validate gift requirements** - Show error if trying to send text-only to non-friend after first message

---

## Complete User Flows

All paths below use the **API Gateway** prefix `/v1/`. Friend-related endpoints use `/v1/friends/me/...` (see [Friends & Messaging](#friends--messaging)).

### Flow 1: New User Onboarding

1. **Sign Up** → `POST /v1/auth/google` (or other auth methods)
2. **Get Tokens** → Store `accessToken` and `refreshToken`
3. **Upload Photo** → `POST /v1/files/upload`
4. **Create Profile** → `POST /v1/users/:userId/profile` (with photo URL)
5. **Add More Photos** → `POST /v1/me/photos` (repeat as needed)
6. **Set Preferences** → Update music, brands, interests, values
7. **Start Discovery** → `GET /v1/discovery/card`

### Flow 2: Discovery & Matching

1. **Get Card** → `GET /v1/discovery/card?sessionId={id}`
2. **User Swipes**:
   - **Left (Pass)** → `POST /v1/discovery/raincheck`
   - **Right (Like)** → `POST /v1/discovery/proceed`
3. **If Match** (both proceed):
   - Both users' status → `IN_SQUAD` (backend sets this)
   - Create room → `POST /v1/streaming/rooms` with matched user IDs
   - Start video call via WebSocket + Mediasoup (see [Streaming & Video Calls](#streaming--video-calls))

### Flow 3: Video Call

1. **Create Room** → `POST /v1/streaming/rooms` (after match); get `roomId` and `sessionId`
2. **Get Room Info** → `GET /v1/streaming/rooms/:roomId` (optional)
3. **Join Call** → Connect WebSocket to streaming service (`ws://.../streaming/ws`), send `join-room` with `roomId`, then use mediasoup-client for create-transport, connect-transport, produce, consume (see [Video Call: WebSocket and Mediasoup](#1a-video-call-websocket-and-mediasoup))
4. **Chat** → Send `chat-message` over WebSocket or `GET /v1/streaming/rooms/:roomId/chat` (optional)
5. **End Call** → `POST /v1/streaming/rooms/:roomId/end` with `userId`; or send `leave-room` over WebSocket
6. **Update Status** → Backend updates status; optionally refresh with `PATCH /v1/me/status` → `IDLE` or `DISCOVERING`

### Flow 4: Purchase Coins

1. **Get Balance** → `GET /v1/wallet/me/balance`
2. **Initiate Purchase** → `POST /v1/payments/purchase/initiate`
3. **Complete Payment** → Use Razorpay SDK on frontend
4. **Verify Purchase** → `POST /v1/payments/purchase/verify`
5. **Update Balance** → Refresh balance display

### Flow 5: Messaging & Conversations

#### 5a. Send First Message to Non-Friend

1. **View Offline Card** → `GET /v1/discovery/offline-cards/card`
2. **Send Friend Request** → `POST /v1/friends/me/friends/offline-cards/request` with `{ toUserId }`
3. **Get Request ID** → From response or `GET /v1/friends/me/friends/requests/sent`
4. **Check Balance** → `GET /v1/wallet/me/balance` (need 10 coins minimum)
5. **Send First Message** → `POST /v1/friends/me/friends/requests/:requestId/messages` with `{ message: "Hello!" }`
   - Costs **10 coins** (or send gift instead)
6. **Conversation Created** → Appears in **SENT_REQUESTS** section
7. **If Recipient Replies** → Conversation moves to **INBOX** automatically

#### 5b. Reply to Received Message

1. **Get Received Requests** → `GET /v1/friends/me/conversations/received-requests`
2. **View Conversation** → `GET /v1/friends/me/conversations/:conversationId/messages`
3. **Send Reply** → `POST /v1/friends/me/conversations/:conversationId/messages` with `{ message: "Hi!" }`
   - **FREE** (first reply is free)
4. **Conversation Promoted** → Moves to **INBOX** (two-sided conversation)

#### 5c. Message a Friend (Free)

1. **Get Inbox** → `GET /v1/friends/me/conversations/inbox`
2. **Select Friend** → Find conversation with `isFriend: true`
3. **Send Message** → `POST /v1/friends/me/friends/:friendId/messages` with `{ message: "Hey!" }`
   - **FREE** (unlimited free messaging)
4. **Or Send Gift** → `POST /v1/friends/me/friends/:friendId/messages` with `{ giftId, giftAmount }`
   - Costs coins (transferred to friend)

#### 5d. Send Gift to Non-Friend

1. **Get Sent Requests** → `GET /v1/friends/me/conversations/sent-requests`
2. **Select Conversation** → Find conversation with non-friend
3. **Check Balance** → `GET /v1/wallet/me/balance`
4. **Send Gift** → `POST /v1/friends/me/conversations/:conversationId/messages` with `{ giftId, giftAmount, message: "Optional message" }`
   - Costs gift amount in coins
   - Text-only messages not allowed after first message

#### 5e. Accept Friend Request & Message

1. **Get Pending Requests** → `GET /v1/friends/me/friends/requests/pending`
2. **View Request Messages** → `GET /v1/friends/me/friends/requests/:requestId/messages`
3. **Accept Request** → `POST /v1/friends/me/friends/requests/:requestId/accept`
4. **Conversation Moved** → Automatically moves to **INBOX**
5. **Message Freely** → `POST /v1/friends/me/friends/:friendId/messages` (all messages free)

### Flow 6: View Conversations by Section

1. **Get All Sections** → Load three tabs:
   - `GET /v1/friends/me/conversations/inbox`
   - `GET /v1/friends/me/conversations/received-requests`
   - `GET /v1/friends/me/conversations/sent-requests`
2. **Display Conversations** → Show with:
   - Last message preview
   - Unread count badge
   - User status (online/offline/broadcasting)
   - Broadcast indicator (if live)
3. **Open Conversation** → `GET /v1/friends/me/conversations/:conversationId/messages`
4. **Send Message** → `POST /v1/friends/me/conversations/:conversationId/messages`
5. **Check Promotion** → If `promotedToInbox: true`, move to INBOX tab

### Flow 7: History (Call History)

1. **Open History** → User taps History in app.
2. **Load History List** → `GET /v1/streaming/history?limit=20`
   - Show each **call** (outer box): `startedAt`, `endedAt`, `callType` (Squad/Broadcast).
   - For each **participant** (inner box): profile photo, `username`, `userStatus` (SQUAD/BROADCAST/DROP_IN), `location`, `durationSeconds`, Hotline action.
3. **Paginate** → If `hasMore` is true, use `nextCursor` for next page:
   - `GET /v1/streaming/history?limit=20&cursor={nextCursor}`
4. **Info Icon** → `GET /v1/streaming/history/:sessionId` for extra call detail.
5. **Trash Icon (Hide)** → `DELETE /v1/streaming/history/:sessionId`; then remove that call from the list (or refetch).
6. **Hotline (Message Participant)**:
   - Use `conversationId` from the participant. If `isFriend`: show “Hotline DM” (free). If not: show “{messageCost} / Hotline DM”.
   - **Message** → `POST /v1/friends/me/conversations/:conversationId/messages` with `{ message }` (or gift). See [Flow 5](#flow-5-messaging--conversations) for cost rules.

---

## Support

For questions or issues:

1. Check this documentation
2. Review API responses and error messages
3. Check service logs
4. Contact backend team

---

**Happy Coding! 🚀**
