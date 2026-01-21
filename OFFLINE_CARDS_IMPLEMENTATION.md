# OFFLINE Cards Feature - Implementation Summary

## Overview
The OFFLINE cards feature allows users to browse profiles of users who are currently ONLINE, OFFLINE, or VIEWER status (not available for video calls). Users can send friend requests, send gifts, or raincheck cards.

## Implementation Details

### 1. Seed Data
**File:** `apps/user-service/prisma/seed-test-users.ts`

Added 10 new test users with different statuses:
- **ONLINE status:** 3 users (test-user-offline-online-1, test-user-offline-online-2, test-user-offline-online-3)
- **OFFLINE status:** 3 users (test-user-offline-offline-1, test-user-offline-offline-2, test-user-offline-offline-3)
- **VIEWER status:** 4 users (test-user-offline-viewer-1 through test-user-offline-viewer-4)

These users are distributed across Mumbai, Delhi, and Bangalore cities.

### 2. Test Files Created

#### Discovery Service
**File:** `apps/discovery-service/src/routes/discovery.controller.offline-cards.test.ts`
- Test cases for getting OFFLINE cards
- Test cases for rainchecking
- Test cases for verifying no match creation
- Test cases for session ID prefix isolation
- Test cases for status filtering

#### Friend Service
**File:** `apps/friend-service/src/routes/friend.controller.offline-cards.test.ts`
- Test cases for sending friend requests from OFFLINE cards
- Test cases for verifying requests work without room context

#### Streaming Service
**File:** `apps/streaming-service/src/controllers/streaming.controller.offline-cards.test.ts`
- Test cases for sending gifts from OFFLINE cards
- Test cases for badge creation
- Test cases for verifying no CallGift record
- Test cases for coin transfer

### 3. HTML Test Interface
**File:** `tests/html-interfaces/comprehensive-test-interface.html`

Added new **Homepage** tab with:
- Form to enter User ID and Session ID
- "Get Next OFFLINE Card" button
- Card display with user information
- Three action buttons:
  - **Raincheck** - Marks card as rainchecked and gets next card
  - **Send Friend Request** - Sends friend request to card user
  - **Send Gift** - Sends gift to card user (prompts for giftId and amount)

### 4. Test Endpoints (Auth Bypass)

All endpoints support test mode with auth bypass:

#### Discovery Service
- `GET /v1/discovery/test/offline-cards/card?userId=xxx&sessionId=xxx&soloOnly=false`
- `POST /v1/discovery/test/offline-cards/raincheck`
  ```json
  {
    "userId": "test-user-mumbai-male-1",
    "sessionId": "test-session-1",
    "raincheckedUserId": "test-user-offline-online-1"
  }
  ```

#### Friend Service
- `POST /v1/friends/test/friends/requests`
  ```json
  {
    "fromUserId": "test-user-mumbai-male-1",
    "toUserId": "test-user-offline-online-1"
  }
  ```

#### Streaming Service
- `POST /v1/streaming/test/offline-cards/gifts`
  ```json
  {
    "fromUserId": "test-user-mumbai-male-1",
    "toUserId": "test-user-offline-online-1",
    "amount": 100,
    "giftId": "monkey"
  }
  ```

## Testing Instructions

### 1. Setup
```bash
# Run seed script to create test users
cd apps/user-service
npx tsx prisma/seed-test-users.ts
```

### 2. Test via HTML Interface
1. Open `tests/html-interfaces/comprehensive-test-interface.html` in browser
2. Go to **Homepage** tab
3. Enter User ID (e.g., `test-user-mumbai-male-1`)
4. Enter Session ID (e.g., `offline-session-1`)
5. Click "Get Next OFFLINE Card"
6. Test actions:
   - Click "Raincheck" to skip card
   - Click "Send Friend Request" to send friend request
   - Click "Send Gift" to send gift (enter giftId and amount when prompted)

### 3. Test via API (cURL/Postman)

#### Get OFFLINE Card
```bash
curl "http://localhost:3000/v1/discovery/test/offline-cards/card?userId=test-user-mumbai-male-1&sessionId=test-session-1"
```

#### Raincheck Card
```bash
curl -X POST "http://localhost:3000/v1/discovery/test/offline-cards/raincheck" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test-user-mumbai-male-1",
    "sessionId": "test-session-1",
    "raincheckedUserId": "test-user-offline-online-1"
  }'
```

#### Send Friend Request
```bash
curl -X POST "http://localhost:3000/v1/friends/test/friends/requests" \
  -H "Content-Type: application/json" \
  -d '{
    "fromUserId": "test-user-mumbai-male-1",
    "toUserId": "test-user-offline-online-1"
  }'
```

#### Send Gift
```bash
curl -X POST "http://localhost:3000/v1/streaming/test/offline-cards/gifts" \
  -H "Content-Type: application/json" \
  -d '{
    "fromUserId": "test-user-mumbai-male-1",
    "toUserId": "test-user-offline-online-1",
    "amount": 100,
    "giftId": "monkey"
  }'
```

## Key Features Verified

✅ **No Match Creation** - OFFLINE cards do NOT create ActiveMatch records  
✅ **Status Preservation** - User statuses remain ONLINE/OFFLINE/VIEWER  
✅ **Session Isolation** - Uses "offline-" prefix to avoid conflicts with video call rainchecks  
✅ **Same Scoring** - Uses existing `calculateMatchScore` and `selectBestMatch` logic  
✅ **Friend Requests** - Works without room context  
✅ **Gifts** - Creates badges without requiring room context  
✅ **Test Mode** - All endpoints support auth bypass for testing  

## Notes

- The OFFLINE cards feature is completely separate from video call matching
- Rainchecks use "offline-{sessionId}" prefix to avoid conflicts
- Gifts from OFFLINE cards do NOT create CallGift records (no room context)
- Badges are still created via wallet-service when giftId is provided
- All test endpoints are available for easy testing without authentication
