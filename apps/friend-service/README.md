# Friend Service

Friend request and messaging service for hmmchat.live. Handles friend requests, friendships, and messaging between users.

## Features

- **In-Call Friend Requests ONLY**: Friend requests can ONLY be sent during video calls via "+" button on participant's video/audio placeholder. There is no other way to send friend requests.
- **No Notifications**: When a user sends a friend request, the target user receives NO notification. They will see the request in their "Pending Requests" tab when they check.
- **Auto-Accept Mutual Requests**: When both users send requests to each other during a call, both requests are automatically accepted and both users are notified.
- **Messaging**:
  - Free messaging between friends
  - Paid messaging to non-friends (10 coins per message, configurable)
  - Message persistence and history
  - Read receipts
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
- `POST /me/friends/:friendId/messages` - Send message to friend (free)
  - Body: `{ message: string }`
- `POST /me/friends/requests/:requestId/messages` - Send message to non-friend (10 coins)
  - Body: `{ message: string }`
- `GET /me/friends/:friendId/messages` - Get message history
  - Query: `?limit=50&cursor=xxx` (pagination)
- `POST /me/friends/:friendId/messages/read` - Mark messages as read

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
PORT=3007
DATABASE_URL="postgresql://..."
JWT_PUBLIC_JWK='...'
WALLET_SERVICE_URL=http://localhost:3006
INTERNAL_SERVICE_TOKEN="your-secret-service-token"  # Required for internal endpoints
REDIS_URL="redis://localhost:6379"  # Optional, for caching (defaults to localhost:6379)
REDIS_ENABLED=true  # Set to false to disable Redis caching
REQUEST_EXPIRY_DAYS=30
MESSAGE_COST_COINS=10
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
```

## Business Rules

1. **In-Call Friend Requests ONLY**: Friend requests can ONLY be sent during video calls via the "+" button on participant's video/audio placeholder. There is no other way to send friend requests (no public API endpoint).
2. **No Notifications**: When User A sends a request to User B, User B receives NO notification. User B will see the request in their "Pending Requests" tab when they check.
3. **Auto-Accept Mutual Requests**: If both users send requests to each other during a call, both requests are automatically accepted and both users are notified via WebSocket.
4. **Unlimited Friends**: No maximum friend limit
5. **Unlimited Messages**: Users can send unlimited messages
   - Free to friends
   - 10 coins per message to non-friends (revenue source)
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
