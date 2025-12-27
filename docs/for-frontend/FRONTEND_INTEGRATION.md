# Auth Service API - Frontend Integration

## 🚀 Getting Started

**Local Setup:** See `FRONTEND_SETUP.md` for backend setup instructions.

**Base URL:** `http://localhost:3001` (development)

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

## Authenticated Endpoints

All authenticated endpoints require header:
```
Authorization: Bearer {accessToken}
```

### Get User Info

**Endpoint:** `GET /me`

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

**Endpoint:** `PATCH /me/preferences`

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

## Token Management

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

## Flows

### Signup/Login Flow
```
1. User selects method (Google/Facebook/Apple/Phone)
2. Get OAuth token from provider SDK
3. POST /auth/{provider} with token + acceptedTerms
4. Store accessToken + refreshToken
```

### Phone OTP Flow
```
1. User enters phone → POST /auth/phone/send-otp
2. User receives SMS OTP
3. User enters OTP → POST /auth/phone/verify
4. Receive accessToken + refreshToken
```

### Authenticated Request Flow
```
1. Include: Authorization: Bearer {accessToken}
2. If 401 → POST /auth/refresh
3. Retry with new accessToken
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
- `400` - Bad Request (validation error)
- `401` - Unauthorized (invalid/expired token)
- `500` - Internal Server Error

---

## Endpoint Reference

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/auth/google` | POST | No | Google signup/login |
| `/auth/facebook` | POST | No | Facebook signup/login |
| `/auth/apple` | POST | No | Apple signup/login |
| `/auth/phone/send-otp` | POST | No | Send OTP |
| `/auth/phone/verify` | POST | No | Verify OTP & signup/login |
| `/me` | GET | Yes | Get user info |
| `/me/preferences` | PATCH | Yes | Update preferences |
| `/auth/refresh` | POST | No | Refresh access token |
| `/auth/logout` | POST | No | Logout user |

---

## Data Types

**Meet Mode Values:**
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
