# Streaming Service - Frontend Integration Guide

## ⚠️ Implementation Status

**Backend:** ✅ **COMPLETE** - Mediasoup server-side is fully implemented and ready  
**Frontend:** ⚠️ **REQUIRED** - Frontend team needs to implement Mediasoup Client integration

See "Frontend Mediasoup Integration - Todo List" section below for implementation steps.

---

## Overview

The Streaming Service handles real-time video/audio calls and broadcasting using WebRTC (via Mediasoup). It supports:
- **Video calls** with 2-4 participants (bidirectional)
- **Broadcasting** where participants stream to viewers
- **Real-time chat** during calls
- **Dares with Gifts** - assign and send dares with virtual gifts (rewards)
- **Icebreakers** - random conversation starters for users in calls

---

## Service Details

**Base URL (Development):** `http://localhost:3005`  
**WebSocket URL:** `ws://localhost:3005/streaming/ws?userId=<userId>`  
**Service Port:** `3005`

---

## Prerequisites

### 1. User Status Flow
Users must follow this status flow:
- `OFFLINE` → `AVAILABLE` (enter matchmaking) → `MATCHED` (matched by discovery service) → `IN_SQUAD` (in call)
- See `USER_STATUS_FLOW.md` for complete status documentation

### 2. Required Services
- **User Service** - Must be running for status validation (in production)
- **Discovery Service** - Sets users to `MATCHED` status
- **Streaming Service** - Handles video calls

### 3. Mediasoup Implementation Status

**✅ Backend Integration: COMPLETE**
- Mediasoup server-side is fully implemented and running
- Routers, transports, producers, and consumers are handled by backend
- No backend work required

**⚠️ Frontend Integration: REQUIRED**
- Frontend team needs to implement Mediasoup Client
- Install `mediasoup-client` package
- Follow integration steps below

---

## Frontend Mediasoup Integration - Todo List

### Setup
- [ ] Install `mediasoup-client` package: `npm install mediasoup-client`
- [ ] Create Mediasoup Device manager/utility class

### Connection Flow
- [ ] Establish WebSocket connection to streaming service
- [ ] Join room via WebSocket (`join-room` message)
- [ ] Receive and store RTP capabilities from `room-joined` event
- [ ] Create Mediasoup Device with RTP capabilities

### Transport Setup
- [ ] Send `create-transport` message (producing: true, consuming: true)
- [ ] Receive `transport-created` event with transport details
- [ ] Create SendTransport using transport details (ICE params, DTLS params)
- [ ] Create RecvTransport for receiving streams
- [ ] Send `connect-transport` message with DTLS parameters from browser

### Audio/Video Production (Send Your Stream)
- [ ] Get user media via `getUserMedia()` API (camera + microphone)
- [ ] Create SendTransport producer for audio track
- [ ] Send `produce` message with audio RTP parameters
- [ ] Create SendTransport producer for video track
- [ ] Send `produce` message with video RTP parameters
- [ ] Display local video in UI (your own video element)

### Audio/Video Consumption (Receive Others' Streams)
- [ ] Listen for `new-producer` events from server
- [ ] For each new producer, send `consume` message
- [ ] Receive `consumed` event with consumer details
- [ ] Create consumer on RecvTransport using consumer RTP parameters
- [ ] Attach consumer track to video/audio element
- [ ] Display remote videos in UI (one element per participant)

### State Management
- [ ] Track active room state (roomId, status, participants)
- [ ] Track all active producers (your own and others')
- [ ] Track all active consumers (receiving streams)
- [ ] Handle participant join/leave events

### Error Handling & Cleanup
- [ ] Handle WebSocket disconnections and reconnections
- [ ] Handle transport/producer/consumer errors
- [ ] Clean up producers/consumers when leaving room
- [ ] Handle "Room not found", "Room full" errors gracefully

### Additional Features
- [ ] Implement chat message sending/receiving
- [ ] Implement broadcast start/join flow (if needed)
- [ ] Implement viewer mode (if needed)
- [ ] Handle mute/unmute, camera on/off controls

---

## REST API Endpoints

### 1. Create Room
**Endpoint:** `POST /streaming/rooms`

**When to use:** When users are matched and ready to start a video call

**Request Body:**
```json
{
  "userIds": ["user1", "user2"]  // 2-4 user IDs
}
```

**Response:**
```json
{
  "roomId": "uuid",
  "sessionId": "uuid"
}
```

**Important:**
- Users must be in `MATCHED` status (enforced in production)
- Minimum 2 users, maximum 4 users
- Users cannot be in another active room

---

### 2. Get Room Info
**Endpoint:** `GET /streaming/rooms/:roomId`

**When to use:** To check room status, participant count, broadcasting status

**Response:**
```json
{
  "exists": true,
  "roomId": "uuid",
  "status": "IN_SQUAD",  // or "IN_BROADCAST", "ENDED"
  "isBroadcasting": false,
  "participantCount": 2,
  "viewerCount": 0,
  "participants": [...],
  "viewers": [...]
}
```

---

### 3. Get User's Room
**Endpoint:** `GET /streaming/users/:userId/room`

**When to use:** To check if a user is currently in a room (for reconnection, status checks)

**Response (user in room):**
```json
{
  "exists": true,
  "role": "participant",  // or "viewer"
  "roomId": "uuid",
  "status": "IN_SQUAD",
  ...
}
```

**Response (user not in room):**
```json
{
  "exists": false
}
```

---

### 4. Get Chat History
**Endpoint:** `GET /streaming/rooms/:roomId/chat`

**When to use:** Load previous chat messages when user joins a room

**Response:**
```json
[
  {
    "id": "msg-id",
    "userId": "user1",
    "message": "Hello!",
    "createdAt": "2026-01-06T..."
  },
  ...
]
```

---

### 5. Get Available Dares
**Endpoint:** `GET /streaming/rooms/:roomId/dares`

**Response:**
```json
{
  "dares": [
    {
      "id": "dare-1",
      "text": "Eat a chilli",
      "category": "fun"
    },
    ...
  ]
}
```

---

### 6. Get Gift List
**Endpoint:** `GET /streaming/rooms/:roomId/dares/gifts`

**Response:**
```json
[
  {
    "id": "monkey",
    "name": "Monkey",
    "emoji": "🐵",
    "diamonds": 50
  },
  ...
]
```

---

### 7. Get Dare History
**Endpoint:** `GET /streaming/rooms/:roomId/dares/history`

**Response:**
```json
[
  {
    "id": "dare-record-id",
    "dareId": "dare-1",
    "dareText": "Eat a chilli",
    "selectedBy": "user1",
    "assignedTo": "user2",
    "status": "sent",
    "giftId": "monkey",
    "giftDiamonds": 50,
    "createdAt": "2026-01-08T...",
    ...
  },
  ...
]
```

---

## WebSocket Connection

### Connection Setup

**URL:** `ws://localhost:3005/streaming/ws?userId=<userId>`

**Query Parameter:**
- `userId` (required) - The current user's ID

**Connection Lifecycle:**
1. Establish WebSocket connection with userId
2. Connection is authenticated via userId (in TEST_MODE, no auth needed)
3. Keep connection alive throughout the call
4. Reconnect if connection drops

---

## WebSocket Messages (Client → Server)

### 1. Join Room
**Message Type:** `join-room`

**When to send:** After room is created via REST API, each participant joins via WebSocket

**Payload:**
```json
{
  "type": "join-room",
  "data": {
    "roomId": "uuid"
  }
}
```

**Server Response:** `room-joined` with RTP capabilities

---

### 2. Leave Room
**Message Type:** `leave-room`

**When to send:** User wants to leave the call

**Payload:**
```json
{
  "type": "leave-room",
  "data": {
    "roomId": "uuid"
  }
}
```

**Note:** User status automatically changes to `AVAILABLE` (back to matchmaking pool)

---

### 3. Create Transport (WebRTC Setup)
**Message Type:** `create-transport`

**When to send:** After receiving `room-joined`, to set up WebRTC transport

**Payload:**
```json
{
  "type": "create-transport",
  "data": {
    "roomId": "uuid",
    "producing": true,   // Will send audio/video
    "consuming": true    // Will receive audio/video
  }
}
```

**Server Response:** `transport-created` with transport details (ICE parameters, DTLS parameters)

---

### 4. Connect Transport
**Message Type:** `connect-transport`

**When to send:** After creating transport and getting ICE candidates from browser

**Payload:**
```json
{
  "type": "connect-transport",
  "data": {
    "roomId": "uuid",
    "transportId": "transport-id",
    "dtlsParameters": { ... }  // From WebRTC library
  }
}
```

---

### 5. Produce (Send Audio/Video)
**Message Type:** `produce`

**When to send:** When user wants to start sending their audio/video stream

**Payload:**
```json
{
  "type": "produce",
  "data": {
    "roomId": "uuid",
    "transportId": "transport-id",
    "kind": "audio",  // or "video"
    "rtpParameters": { ... }  // From WebRTC library
  }
}
```

**Server Response:** `produced` with producer ID

**Note:** Send separate messages for audio and video

---

### 6. Consume (Receive Audio/Video)
**Message Type:** `consume`

**When to send:** When you want to receive audio/video from another participant

**Payload:**
```json
{
  "type": "consume",
  "data": {
    "roomId": "uuid",
    "transportId": "transport-id",
    "producerId": "producer-id",  // From "new-producer" event
    "rtpCapabilities": { ... }  // Received in "room-joined"
  }
}
```

**Server Response:** `consumed` with consumer details and RTP parameters

---

### 7. Start Broadcast
**Message Type:** `start-broadcast`

**When to send:** Participants want to start broadcasting to viewers

**Payload:**
```json
{
  "type": "start-broadcast",
  "data": {
    "roomId": "uuid"
  }
}
```

**Server Response:** `broadcast-started` confirmation

**Note:** Only participants can start broadcasts. All participants' status changes to `IN_BROADCAST`

---

### 8. Join as Viewer
**Message Type:** `join-as-viewer`

**When to send:** User wants to watch a broadcast (not participate)

**Payload:**
```json
{
  "type": "join-as-viewer",
  "data": {
    "roomId": "uuid"
  }
}
```

**Server Response:** `viewer-joined` with RTP capabilities

**Note:** 
- Room must be broadcasting
- Viewers cannot send audio/video
- Viewers only consume (receive) streams

---

### 9. Send Chat Message
**Message Type:** `chat-message`

**When to send:** User types a message in chat

**Payload:**
```json
{
  "type": "chat-message",
  "data": {
    "roomId": "uuid",
    "message": "Hello everyone!"
  }
}
```

**Server Response:** `chat-message` with full message details

**Note:** Message is also broadcast to all participants/viewers in the room

---

### 10. View Dare (Real-time Sync)
**Message Type:** `dare-view`

**When to send:** User scrolls through dares - broadcasts to all participants so everyone sees the same dare

**Payload:**
```json
{
  "type": "dare-view",
  "data": {
    "roomId": "uuid",
    "dareId": "dare-1"
  }
}
```

**Server Response:** `dare-viewed` confirmation

**Note:** All participants receive `dare-viewing` event to sync UI

---

### 11. Assign Dare
**Message Type:** `dare-assign`

**When to send:** User selects a participant to assign the dare to (required for 3+ users, optional for 2 users)

**Payload:**
```json
{
  "type": "dare-assign",
  "data": {
    "roomId": "uuid",
    "dareId": "dare-1",
    "assignedToUserId": "user2"
  }
}
```

**Server Response:** `dare-assigned-success` confirmation

**Note:** 
- Cannot assign to yourself
- Must assign to a participant in the room
- For 2-user calls, assignment is optional (auto-assigns when sending)

---

### 12. Send Dare with Gift
**Message Type:** `dare-send`

**When to send:** User sends a dare with a selected gift (transfers 100% payment immediately)

**Payload:**
```json
{
  "type": "dare-send",
  "data": {
    "roomId": "uuid",
    "dareId": "dare-1",
    "giftId": "monkey"
  }
}
```

**Server Response:** `dare-sent-success` with transaction details

**Important Business Rules:**
- **Only ONE active dare per room at a time** - If a dare is already active ("sent" status), sending another will fail
- **All participants see the dare** - The `dare-sent` event is broadcast to everyone
- **Auto-assignment for 2 users** - If there are exactly 2 participants and no assignment exists, it auto-assigns to the other user
- **100% payment on send** - Full gift amount (in diamonds, converted to coins) is transferred immediately to the assigned user
- **Payment requires sufficient balance** - User must have enough diamonds/coins for the selected gift

**Note:** Gift diamonds are converted to coins at rate 1 diamond = 50 coins (configurable)

---

### 13. Get Icebreaker
**Message Type:** `get-icebreaker`

**When to send:** User wants a random conversation starter

**Payload:**
```json
{
  "type": "get-icebreaker",
  "data": {
    "roomId": "uuid"
  }
}
```

**Server Response:** `icebreaker` with random question

**Note:**
- Only sent to the requesting user (NOT broadcasted to others)
- User must be a participant in the room
- No rewards, no assignment - just a fun conversation starter
- Examples: "What's your favorite movie of the year?", "What's your dream vacation destination?"

---

## WebSocket Messages (Server → Client)

### 1. Room Joined
**Message Type:** `room-joined`

**When received:** After sending `join-room` message

**Payload:**
```json
{
  "type": "room-joined",
  "data": {
    "roomId": "uuid",
    "rtpCapabilities": { ... }  // Required for WebRTC setup
  }
}
```

**Action Required:** Store `rtpCapabilities` - needed for creating producers/consumers

---

### 2. Transport Created
**Message Type:** `transport-created`

**When received:** After sending `create-transport` message

**Payload:**
```json
{
  "type": "transport-created",
  "data": {
    "id": "transport-id",
    "iceParameters": { ... },
    "iceCandidates": [ ... ],
    "dtlsParameters": { ... }
  }
}
```

**Action Required:** Use these parameters to set up WebRTC transport in your WebRTC library

---

### 3. Produced
**Message Type:** `produced`

**When received:** After sending `produce` message

**Payload:**
```json
{
  "type": "produced",
  "data": {
    "id": "producer-id",
    "kind": "audio"  // or "video"
  }
}
```

**Action Required:** Store producer ID. Server will notify other participants via `new-producer` event

---

### 4. Consumed
**Message Type:** `consumed`

**When received:** After sending `consume` message

**Payload:**
```json
{
  "type": "consumed",
  "data": {
    "id": "consumer-id",
    "producerId": "producer-id",
    "kind": "audio",
    "rtpParameters": { ... }
  }
}
```

**Action Required:** Use `rtpParameters` to create consumer track and display video/audio

---

### 5. New Producer (Participant Started Streaming)
**Message Type:** `new-producer`

**When received:** When another participant starts sending audio/video

**Payload:**
```json
{
  "type": "new-producer",
  "data": {
    "userId": "user2",
    "producerId": "producer-id",
    "kind": "video"
  }
}
```

**Action Required:** Send `consume` message to receive this participant's stream

---

### 6. Broadcast Started
**Message Type:** `broadcast-started`

**When received:** When broadcast starts in the room

**Payload:**
```json
{
  "type": "broadcast-started",
  "data": {
    "roomId": "uuid"
  }
}
```

**Action Required:** Update UI to show "Broadcasting" status

---

### 7. Viewer Joined
**Message Type:** `viewer-joined`

**When received:** After sending `join-as-viewer` message

**Payload:**
```json
{
  "type": "viewer-joined",
  "data": {
    "roomId": "uuid",
    "rtpCapabilities": { ... }
  }
}
```

**Action Required:** Store `rtpCapabilities` and start consuming participant streams

---

### 8. Chat Message
**Message Type:** `chat-message`

**When received:** When any participant/viewer sends a chat message

**Payload:**
```json
{
  "type": "chat-message",
  "data": {
    "userId": "user1",
    "message": "Hello!",
    "createdAt": "2026-01-06T..."
  }
}
```

**Action Required:** Display message in chat UI

---

### 9. Dare Viewing (Sync)
**Message Type:** `dare-viewing`

**When received:** When another participant views a dare (for UI sync)

**Payload:**
```json
{
  "type": "dare-viewing",
  "data": {
    "roomId": "uuid",
    "dareId": "dare-1",
    "viewedBy": "user1"
  }
}
```

**Action Required:** Update UI to show the same dare being viewed

---

### 10. Dare Assigned
**Message Type:** `dare-assigned`

**When received:** When a dare is assigned to a participant

**Payload:**
```json
{
  "type": "dare-assigned",
  "data": {
    "roomId": "uuid",
    "dareId": "dare-1",
    "assignedBy": "user1",
    "assignedTo": "user2"
  }
}
```

**Action Required:** Update UI to show dare assignment

---

### 11. Dare Sent
**Message Type:** `dare-sent`

**When received:** When a dare is sent with a gift (broadcasted to ALL participants)

**Payload:**
```json
{
  "type": "dare-sent",
  "data": {
    "roomId": "uuid",
    "dareId": "dare-1",
    "giftId": "monkey",
    "sentBy": "user1",
    "assignedTo": "user2",
    "wasAutoAssigned": false
  }
}
```

**Action Required:** 
- Display the dare and gift to ALL participants (not just the assigned user)
- Show payment confirmation
- Update UI to indicate there's now an active dare in the room

**Important:** Only ONE dare can be active at a time. If a new dare is attempted while one is active, it will fail.

---

### 12. Icebreaker
**Message Type:** `icebreaker`

**When received:** After sending `get-icebreaker` message

**Payload:**
```json
{
  "type": "icebreaker",
  "data": {
    "roomId": "uuid",
    "question": "What's your favorite movie of the year?"
  }
}
```

**Action Required:** Display the question to the user (only shown to them, not others)

---

### 13. Error
**Message Type:** `error`

**When received:** When any operation fails

**Payload:**
```json
{
  "type": "error",
  "data": {
    "error": "Error message here"
  }
}
```

**Action Required:** Display error to user and handle appropriately

---

## Integration Flow for Video Calls

### Phase 1: Room Creation
1. Users are matched by Discovery Service → Status becomes `MATCHED`
2. Frontend calls `POST /streaming/rooms` with matched user IDs
3. Receive `roomId` and `sessionId`

### Phase 2: WebSocket Connection
1. Each participant connects WebSocket: `ws://localhost:3005/streaming/ws?userId=<userId>`
2. Send `join-room` message with `roomId`
3. Receive `room-joined` with `rtpCapabilities` (save this!)

### Phase 3: WebRTC Setup
1. Send `create-transport` message (producing: true, consuming: true)
2. Receive `transport-created` with transport details
3. Use transport details to create WebRTC transport in browser
4. Send `connect-transport` with DTLS parameters from browser

### Phase 4: Start Sending Audio/Video
1. Get user's camera/microphone via browser API (`getUserMedia`)
2. Send `produce` message for audio
3. Receive `produced` confirmation
4. Send `produce` message for video
5. Receive `produced` confirmation

### Phase 5: Receive Other Participants' Streams
1. Listen for `new-producer` events
2. For each new producer, send `consume` message
3. Receive `consumed` with consumer details
4. Use consumer details to display remote video/audio

### Phase 6: Call Management
- **Leave call:** Send `leave-room` message
- **Send chat:** Send `chat-message` message
- **Start broadcast:** Send `start-broadcast` message (participants only)
- **Get icebreaker:** Send `get-icebreaker` message for conversation starters
- **View dares:** Send `dare-view` to browse dares (syncs with all participants)
- **Assign dare:** Send `dare-assign` to assign dare to a participant (3+ users)
- **Send dare:** Send `dare-send` to send dare with gift (only one active dare at a time)

---

## Integration Flow for Viewers

### Phase 1: Find Broadcast
1. Get list of active broadcasts (via Discovery Service or custom endpoint)
2. User selects a broadcast to watch

### Phase 2: Connect as Viewer
1. Connect WebSocket: `ws://localhost:3005/streaming/ws?userId=<userId>`
2. Send `join-as-viewer` message with `roomId`
3. Receive `viewer-joined` with `rtpCapabilities`

### Phase 3: Receive Streams
1. Get list of producers (participants broadcasting)
2. Create transport for consuming only
3. For each producer, send `consume` message
4. Receive and display video/audio streams

---

## Key Integration Points

### 1. Status Management
- **Critical:** Frontend must manage user status correctly
- Before creating room: User must be `MATCHED`
- After room created: Status becomes `IN_SQUAD`
- After leaving: Status becomes `AVAILABLE`
- See `USER_STATUS_FLOW.md` for complete flow

### 2. Room State Persistence
- Rooms persist in database even after service restart
- Use `GET /streaming/users/:userId/room` to check if user has active room
- Handle reconnection scenarios gracefully

### 3. WebRTC Library Requirements
Frontend needs WebRTC library that supports:
- **SFU (Selective Forwarding Unit)** architecture
- Producer/Consumer pattern
- RTP capabilities negotiation
- ICE candidate handling
- DTLS parameter exchange

**Required:** Mediasoup Client (`mediasoup-client`) - See "Frontend Mediasoup Integration" section above for implementation steps

### 4. Error Handling
- All WebSocket messages can return `error` type
- Handle "Room not found", "Room is full", "User not participant" errors
- Implement retry logic for network failures
- Handle WebSocket disconnections and reconnections

### 5. Real-time Updates
- Listen for `new-producer` events to know when participants join/start streaming
- Listen for `chat-message` events for real-time chat
- Listen for `dare-viewing` to sync dare browsing across participants
- Listen for `dare-assigned` and `dare-sent` for dare flow updates
- Poll room info periodically or listen for state change events

### 6. Dare Feature Flow
**Important Business Rules:**
1. **Only ONE active dare per room** - When a dare is "sent", it becomes active. No other dare can be sent until the active one is completed/cancelled
2. **All participants see active dares** - When a dare is sent, all participants/viewers receive the `dare-sent` event
3. **Dare assignment:**
   - For 2-user calls: Optional (auto-assigns when sending)
   - For 3+ user calls: Required before sending
4. **Payment flow:** 100% of gift diamonds (converted to coins) are transferred immediately upon sending
5. **Viewing sync:** When a user scrolls through dares (`dare-view`), all participants see the same dare (via `dare-viewing` event)

### 7. Icebreaker Feature
- Simple feature: User clicks button → receives random conversation starter
- **Not broadcasted** - Only the requesting user sees it
- No rewards, no assignment, just fun questions to spark conversations
- Available at any time during a call (doesn't interfere with dares)

---

## Testing Mode

**TEST_MODE=true:**
- Status validation is **skipped**
- No authentication required
- Can test without user-service or discovery-service
- Useful for development and testing

**Production:**
- All validations enforced
- User status must be `MATCHED` to create/join rooms
- Requires user-service and discovery-service

---

## Important Notes

1. **Room Limits:**
   - Minimum 2 participants, maximum 4 participants
   - Room automatically ends if only 1 participant remains

2. **Status Transitions:**
   - Users must be `MATCHED` before creating/joining rooms
   - Status automatically updates (handled by backend)
   - Frontend should sync status with user-service

3. **WebSocket Connection:**
   - Keep connection alive throughout the call
   - Reconnect on disconnection
   - Handle connection errors gracefully

4. **Broadcasting:**
   - Only participants can start broadcasts
   - Participants cannot join as viewers
   - Viewers go to `OFFLINE` status when they leave (not `AVAILABLE`)

5. **Database Consistency:**
   - Backend uses database as source of truth
   - Rooms persist even after service restart
   - All validations check database state

---

## Common Integration Scenarios

### Scenario 1: User Joins Existing Call
1. Check if user has active room: `GET /streaming/users/:userId/room`
2. If exists, connect WebSocket and send `join-room`
3. Follow Phase 2-5 of integration flow

### Scenario 2: User Reconnects Mid-Call
1. Check active room: `GET /streaming/users/:userId/room`
2. Reconnect WebSocket
3. Rejoin room and recreate transports
4. Resume producing/consuming

### Scenario 3: Broadcast Ends While Viewing
1. Listen for room state changes
2. When broadcast ends, viewers are automatically removed
3. Handle transition back to main screen

### Scenario 4: Participant Leaves (Last 2 Users)
1. When user leaves, check remaining participant count
2. If count becomes 1, room auto-ends
3. All participants receive notification and return to matchmaking

---

## Required Frontend Capabilities

1. **WebRTC/Mediasoup Integration**
   - Ability to create transports
   - Handle ICE candidates
   - Create producers (send audio/video)
   - Create consumers (receive audio/video)
   - Display video streams in UI

2. **WebSocket Management**
   - Maintain persistent connection
   - Handle reconnections
   - Message queueing during disconnection

3. **State Management**
   - Track room state
   - Track participant list
   - Track active producers/consumers
   - Handle status transitions

4. **Error Handling**
   - Network errors
   - WebRTC errors
   - Service errors
   - User-friendly error messages

---

## Support & Resources

- **Interactive Test Tool:** `tests/streaming-service/interactive-test.html` (for testing without frontend)
- **Business Rules:** `apps/streaming-service/BUSINESS_RULES.md`
- **Status Flow:** `apps/streaming-service/USER_STATUS_FLOW.md`
- **Production Audit:** `apps/streaming-service/PRODUCTION_READINESS_AUDIT.md`

---

## Next Steps

**Note:** Backend Mediasoup integration is complete. Frontend team should:

1. Review "Frontend Mediasoup Integration - Todo List" section above
2. Install `mediasoup-client` package
3. Follow the step-by-step integration flow
4. Test with interactive test tool first
5. Integrate with UI components

For detailed implementation, refer to the integration flow sections in this document and `STREAMING_VIDEO_CALL_EXPLAINED.md` for conceptual understanding.

