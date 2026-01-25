# Friend Service

Friend request and messaging service for hmmchat.live. Handles friend requests, friendships, and messaging between users.

## Features

- **In-Call Friend Requests ONLY**: Friend requests can ONLY be sent during video calls via "+" button on participant's video/audio placeholder. There is no other way to send friend requests.
- **No Notifications**: When a user sends a friend request, the target user receives NO notification. They will see the request in their "Pending Requests" tab when they check.
- **Auto-Accept Mutual Requests**: When both users send requests to each other during a call, both requests are automatically accepted and both users are notified.
- **Messaging Sections**:
  - **Inbox**: Friends and users who have conversed (two-sided messages)
  - **Received Requests**: Users who messaged you but you haven't replied (one-sided)
  - **Sent Requests**: Users you messaged but they haven't replied (one-sided)
- **Messaging**:
  - Free unlimited messaging in Inbox section
  - First message to non-friend costs coins (configurable, default: 10 coins)
  - Subsequent messages require gifts (gift + optional message)
  - Gift-only messages allowed anytime
  - Message persistence and history
  - Read receipts
  - Gift support (send gifts with messages)
- **Monetization**:
  - First message cost: Configurable via `FIRST_MESSAGE_COST_COINS` (default: 10 coins)
  - Subsequent messages: Only with gifts
  - Gifts: Various gift options with different coin costs
- **Security & Validation**:
  - Rate limiting (configurable per message/gift)
  - Spam detection (duplicate message prevention)
  - Blocked user validation
  - Account status validation (deactivated/suspended)
  - Message length limits (max 1000 characters)
- **Blocking**: Block users to prevent future interactions
- **Request Expiration**: Friend requests expire after 30 days (configurable)

## Endpoints

### Authenticated Endpoints

All endpoints require `Authorization: Bearer {accessToken}` header.

#### Friend Requests
- **Note**: Friend requests can ONLY be sent during video calls via the "+" button. There is no public API endpoint for sending friend requests.
- `GET /me/friends/requests/pending` - Get incoming requests
- `GET /me/friends/requests/sent` - Get outgoing requests (with pagination)
- `GET /me/friends/requests/sent` - Get outgoing requests
- `GET /me/friends/requests/:requestId/messages` - Get messages for a request
- `POST /me/friends/requests/:requestId/accept` - Accept request
- `POST /me/friends/requests/:requestId/reject` - Reject request

#### Friends
- `GET /me/friends` - Get all friends (with pagination)
  - Query params: `?limit=50&cursor=xxx`
  - Response: `{ friends: [...], nextCursor?: string, hasMore: boolean }`
- `POST /me/friends/:friendId/unfriend` - Unfriend a user (remove friendship)
- `POST /me/friends/:friendId/block` - Block a user

#### Messages
- `POST /me/friends/:friendId/messages` - Send message to friend (free, supports gifts)
  - Body: `{ message?: string, giftId?: string, giftAmount?: number }`
- `POST /me/friends/requests/:requestId/messages` - Send message to non-friend (first message costs coins, subsequent require gifts)
  - Body: `{ message?: string, giftId?: string, giftAmount?: number }`
- `GET /me/friends/:friendId/messages` - Get message history
  - Query: `?limit=50&cursor=xxx` (pagination, max limit: 100)
- `POST /me/friends/:friendId/messages/read` - Mark messages as read

#### Conversations (New)
- `GET /me/conversations/inbox` - Get inbox conversations (friends + two-sided)
  - Query: `?limit=50&cursor=xxx` (pagination, max limit: 100)
  - Returns: Conversations with last message, unread count, friend status, user status, and broadcast info
  - Response includes: `userStatus` ("online" | "offline" | "broadcasting"), `isBroadcasting`, `broadcastRoomId`, `broadcastUrl` (deep link)
- `GET /me/conversations/received-requests` - Get received requests (they messaged you)
  - Query: `?limit=50&cursor=xxx` (pagination, max limit: 100)
  - Response includes user status and broadcast info
- `GET /me/conversations/sent-requests` - Get sent requests (you messaged them)
  - Query: `?limit=50&cursor=xxx` (pagination, max limit: 100)
  - Response includes user status and broadcast info
- `POST /me/conversations/:conversationId/messages` - Send message via conversation ID
  - Body: `{ message?: string, giftId?: string, giftAmount?: number }`
  - Auto-promotes to inbox if conversation becomes two-sided
- `GET /me/conversations/:conversationId/messages` - Get messages for a conversation
  - Query: `?limit=50&cursor=xxx` (pagination, max limit: 100)

**Note:** Chat heads (display pictures) show user status indicators:
- **Green dot**: User is online
- **Broadcasting indicator**: User is currently broadcasting (clicking chat head redirects to their broadcast on hmm_TV)
- **Offline**: User is offline

When a user is broadcasting, clicking their chat head (display picture) will redirect to their broadcast feed on `hmm_TV` in TikTok-like format, landing directly on their specific broadcast. Users can scroll to see the next broadcasts.

### Internal Endpoints (Service-to-Service)

- `POST /internal/friends/requests` - Send friend request during call (called by streaming-service)
  - Headers: `x-service-token: {INTERNAL_SERVICE_TOKEN}`
  - Body: `{ fromUserId: string, toUserId: string, roomId?: string }`
  - Response: `{ ok: boolean, requestId: string, autoAccepted: boolean }`
- `GET /internal/metrics` - Get service metrics (for monitoring)
  - Headers: `x-service-token: {INTERNAL_SERVICE_TOKEN}` (optional)
  - Response: Metrics object with counters and calculated rates

## Environment Variables

```bash
PORT=3009
DATABASE_URL="postgresql://..."
JWT_PUBLIC_JWK='...'
WALLET_SERVICE_URL=http://localhost:3005
AUTH_SERVICE_URL=http://localhost:3001  # For account status checks
STREAMING_SERVICE_URL=http://localhost:3005  # For broadcast status checks
APP_DEEP_LINK_BASE_URL=https://app.hmmchat.live  # Base URL for broadcast deep links
INTERNAL_SERVICE_TOKEN="your-secret-service-token"  # Required for internal endpoints
REDIS_URL="redis://localhost:6379"  # Optional, for caching and rate limiting (defaults to localhost:6379)
REDIS_ENABLED=true  # Set to false to disable Redis caching
REQUEST_EXPIRY_DAYS=30
MESSAGE_COST_COINS=10  # Legacy (for backward compatibility)
FIRST_MESSAGE_COST_COINS=10  # Cost for first message to non-friend (configurable)
MESSAGE_RATE_LIMIT=10  # Messages per time window
GIFT_RATE_LIMIT=5  # Gifts per time window
RATE_LIMIT_WINDOW=60  # Time window in seconds
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

**Note:** `INTERNAL_SERVICE_TOKEN` must be the same value in both `friend-service` and `streaming-service` for service-to-service communication.

## Database Setup

```bash
# Generate Prisma client
npm run prisma:generate

# Run migrations
npm run prisma:migrate

# Or push schema (development)
npm run prisma:push

# Seed gift catalog (after migration)
npm run seed:gifts

# Migrate existing messages to conversations (after migration)
npm run migrate:conversations
```

## Business Rules

1. **In-Call Friend Requests ONLY**: Friend requests can ONLY be sent during video calls via the "+" button on participant's video/audio placeholder. There is no other way to send friend requests (no public API endpoint).
2. **No Notifications**: When User A sends a request to User B, User B receives NO notification. User B will see the request in their "Pending Requests" tab when they check.
3. **Auto-Accept Mutual Requests**: If both users send requests to each other during a call, both requests are automatically accepted and both users are notified via WebSocket.
4. **Unlimited Friends**: No maximum friend limit
5. **Messaging Rules**:
   - **Inbox**: Unlimited free messaging (friends + two-sided conversations)
   - **Received/Sent Requests**: 
     - First message costs coins (configurable, default: 10 coins)
     - Subsequent messages require gifts (gift + optional message)
     - Gift-only messages allowed anytime
   - When user replies, conversation automatically moves to Inbox (two-sided)
6. **Request Expiration**: Requests expire after 30 days
7. **Message Persistence**: All messages are stored permanently
8. **Read Receipts**: Messages can be marked as read
9. **No Post-Call Screens**: Users go directly to AVAILABLE status after leaving call (no intermediate screens)

## WebSocket Integration (Streaming Service)

During video calls, users can send friend requests via WebSocket:

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

**If Pending:** No notification sent to target user. They will see the request in their "Pending Requests" tab when they check.
