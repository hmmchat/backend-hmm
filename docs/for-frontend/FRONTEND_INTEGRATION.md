# Frontend Integration Guide

Complete API integration guide for all backend services. This document covers every use case and endpoint you'll need to build the frontend.

## 📚 Table of Contents

1. [Getting Started](#getting-started)
2. [Authentication & User Onboarding](#authentication--user-onboarding)
3. [User Profile Management](#user-profile-management)
4. [Discovery & Matching](#discovery--matching)
5. [Streaming & Video Calls](#streaming--video-calls)
6. [Friends & Messaging](#friends--messaging)
7. [Wallet & Payments](#wallet--payments)
8. [File Uploads](#file-uploads)
9. [Error Handling](#error-handling)

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
- Streaming: `http://localhost:3005`
- Wallet: `http://localhost:3006`
- Payment: `http://localhost:3007`
- Friend: `http://localhost:3009`
- Files: `http://localhost:3008`

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

**Endpoint:** `GET /brands`

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

**Endpoint:** `GET /interests`

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

**Endpoint:** `GET /values`

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

### 1. Create Room

**Endpoint:** `POST /streaming/rooms`

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
  "token": "string",  // Agora token for video call
  "channelName": "string",  // Agora channel name
  "appId": "string",  // Agora app ID
  "userIds": ["user-id-1", "user-id-2"],
  "hostId": "user-id-1",  // First user is host
  "callType": "matched"
}
```

**Use Case:** 
- Called automatically when users match (both proceed)
- Or when creating a squad call

**Important:** 
- Store `token`, `channelName`, and `appId` for Agora SDK
- Use these to join video call

### 2. Get Room Info

**Endpoint:** `GET /streaming/rooms/:roomId`

**Response:**
```json
{
  "exists": true,
  "roomId": "string",
  "userIds": ["user-id-1", "user-id-2"],
  "hostId": "user-id-1",
  "callType": "matched",
  "status": "active",  // "active" | "ended"
  "createdAt": "string"
}
```

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

---

## Friends & Messaging

### 1. Send Friend Request

**Endpoint:** `POST /me/friends/requests`

**Request:**
```json
{
  "toUserId": "string"
}
```

**Response:**
```json
{
  "id": "string",
  "fromUserId": "string",
  "toUserId": "string",
  "status": "PENDING",
  "createdAt": "string"
}
```

### 2. Get Pending Friend Requests

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
        "displayPictureUrl": "string"
      },
      "status": "PENDING",
      "createdAt": "string"
    }
  ]
}
```

### 3. Get Sent Friend Requests

**Endpoint:** `GET /me/friends/requests/sent`

**Response:** Same format as pending requests

### 4. Accept Friend Request

**Endpoint:** `POST /me/friends/requests/:requestId/accept`

**Response:**
```json
{
  "success": true,
  "friendship": {
    "id": "string",
    "user1Id": "string",
    "user2Id": "string",
    "status": "FRIENDS",
    "createdAt": "string"
  }
}
```

### 5. Reject Friend Request

**Endpoint:** `POST /me/friends/requests/:requestId/reject`

**Response:**
```json
{
  "success": true
}
```

### 6. Get Friends List

**Endpoint:** `GET /me/friends`

**Response:**
```json
{
  "friends": [
    {
      "id": "string",
      "userId": "string",
      "user": {
        "id": "string",
        "username": "string",
        "displayPictureUrl": "string"
      },
      "status": "FRIENDS",
      "createdAt": "string"
    }
  ]
}
```

### 7. Send Message to Friend

**Endpoint:** `POST /me/friends/:friendId/messages`

**Request:**
```json
{
  "message": "Hello!"
}
```

**Response:**
```json
{
  "id": "string",
  "userId": "string",
  "friendId": "string",
  "message": "Hello!",
  "read": false,
  "timestamp": "string"
}
```

### 8. Get Messages with Friend

**Endpoint:** `GET /me/friends/:friendId/messages`

**Query Parameters:**
- `limit` (optional): Number of messages (default 50)
- `before` (optional): Get messages before this timestamp

**Response:**
```json
{
  "messages": [
    {
      "id": "string",
      "userId": "string",
      "message": "string",
      "read": false,
      "timestamp": "string"
    }
  ]
}
```

### 9. Mark Messages as Read

**Endpoint:** `POST /me/friends/:friendId/messages/read`

**Request:**
```json
{
  "messageIds": ["message-id-1", "message-id-2"]  // Optional, marks all if not provided
}
```

### 10. Unfriend

**Endpoint:** `POST /me/friends/:friendId/unfriend`

**Response:**
```json
{
  "success": true
}
```

### 11. Block User

**Endpoint:** `POST /me/friends/:friendId/block`

**Response:**
```json
{
  "success": true
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

## File Uploads

### 1. Upload File

**Endpoint:** `POST /files/upload`

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
const uploadFile = async (file) => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('folder', 'profile-pictures');
  formData.append('processImage', 'true');
  formData.append('maxWidth', '800');
  formData.append('maxHeight', '800');
  
  const response = await fetch('http://localhost:3008/files/upload', {
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

**Endpoint:** `GET /me/files`

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

---

## Complete User Flows

### Flow 1: New User Onboarding

1. **Sign Up** → `POST /v1/auth/google` (or other auth methods)
2. **Get Tokens** → Store `accessToken` and `refreshToken`
3. **Upload Photo** → `POST /files/upload`
4. **Create Profile** → `POST /users/:userId/profile` (with photo URL)
5. **Add More Photos** → `POST /me/photos` (repeat as needed)
6. **Set Preferences** → Update music, brands, interests, values
7. **Start Discovery** → `GET /discovery/card`

### Flow 2: Discovery & Matching

1. **Get Card** → `GET /discovery/card?sessionId={id}`
2. **User Swipes**:
   - **Left (Pass)** → `POST /discovery/raincheck`
   - **Right (Like)** → `POST /discovery/proceed`
3. **If Match** (both proceed):
   - Both users' status → `IN_SQUAD`
   - Create room → `POST /streaming/rooms`
   - Start video call with Agora SDK

### Flow 3: Video Call

1. **Create Room** → `POST /streaming/rooms` (after match)
2. **Get Room Info** → `GET /streaming/rooms/:roomId`
3. **Join Call** → Use Agora SDK with `token`, `channelName`, `appId`
4. **Chat** → `GET /streaming/rooms/:roomId/chat` (optional)
5. **End Call** → `POST /streaming/rooms/:roomId/end`
6. **Update Status** → `PATCH /me/status` → `IDLE` or `DISCOVERING`

### Flow 4: Purchase Coins

1. **Get Balance** → `GET /me/balance`
2. **Initiate Purchase** → `POST /v1/payments/purchase/initiate`
3. **Complete Payment** → Use Razorpay SDK on frontend
4. **Verify Purchase** → `POST /v1/payments/purchase/verify`
5. **Update Balance** → Refresh balance display

---

## Support

For questions or issues:

1. Check this documentation
2. Review API responses and error messages
3. Check service logs
4. Contact backend team

---

**Happy Coding! 🚀**
