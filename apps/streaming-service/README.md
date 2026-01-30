# Streaming Service

Video calling and broadcasting service for hmmchat.live. Implements SFU-based video calls for 2-4 participants with optional broadcasting to viewers.

## Features

- **Video Calling (IN_SQUAD)**: 2-4 participants in bidirectional video calls
- **Room Creation**: Requires 2 users accepting each other's cards (single users cannot create rooms)
- **Single User Support**: Once created, rooms can continue with 1 participant (others can leave)
- **Broadcasting (IN_BROADCAST)**: One-way streaming to viewers
- **In-Call Features**: Dares, gifts, and real-time chat
- **SFU Architecture**: Uses Mediasoup for efficient media routing

## Architecture

### Core Call (IN_SQUAD)
- 2-4 participants in bidirectional video calls (to create room)
- Once created, room can continue with 1 participant if others leave
- All participants send and receive video/audio
- Dynamic participant management (add 3rd/4th person)

### Broadcasting (IN_BROADCAST)
- Core participants can broadcast their call
- Viewers watch the stream (one-way)
- Supports unlimited viewers per broadcast

### Technology Stack
- **SFU**: Mediasoup (Selective Forwarding Unit)
- **WebRTC**: For peer-to-peer media transport
- **WebSocket**: For signaling (offer/answer, ICE)
- **PostgreSQL**: For call session and event storage
- **NestJS + Fastify**: HTTP and WebSocket server

## Setup

### Prerequisites
- Node.js v22+
- PostgreSQL database
- Mediasoup dependencies (see below)

### Installation

```bash
cd apps/streaming-service
npm install
```

### Environment Variables

Create a `.env` file:

```env
# Server
PORT=3006
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/streaming_db

# Mediasoup Configuration
MEDIASOUP_WORKERS=4
MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_ANNOUNCED_IP=127.0.0.1  # Your public IP in production

# Room Configuration
MAX_PARTICIPANTS_PER_CALL=4
MAX_VIEWERS_PER_BROADCAST=1000

# JWT Authentication
JWT_PUBLIC_JWK='{"kty":"RSA",...}'

# Service URLs
DISCOVERY_SERVICE_URL=http://localhost:3004
WALLET_SERVICE_URL=http://localhost:3005
DISCOVERY_SERVICE_TIMEOUT_MS=5000
```

### Database Setup

```bash
# Generate Prisma client
npm run prisma:generate

# Run migrations
npm run prisma:migrate

# Or push schema (development)
npm run prisma:push
```

### Mediasoup System Requirements

Mediasoup requires system dependencies. On Ubuntu/Debian:

```bash
sudo apt-get update
sudo apt-get install -y \
  build-essential \
  python3 \
  libssl-dev \
  libasound2-dev \
  libpulse-dev \
  libvpx-dev \
  libopus-dev \
  libsrtp2-dev
```

On macOS:

```bash
brew install openssl libsrtp opus libvpx
```

## Running

### Development

```bash
npm run start:dev
```

### Production

```bash
npm run build
npm start
```

## API Endpoints

### REST API

#### Create Room
```http
POST /streaming/rooms
Content-Type: application/json

{
  "userIds": ["user1", "user2"]
}
```

#### Get Room Info
```http
GET /streaming/rooms/:roomId
```

#### Get Chat History
```http
GET /streaming/rooms/:roomId/chat
```

#### Get Dare List
```http
GET /streaming/rooms/:roomId/dares
```

#### Select Dare
```http
POST /streaming/rooms/:roomId/dares/select
Content-Type: application/json

{
  "dareId": "dare-1",
  "userId": "user1"
}
```

#### Send Gift
```http
POST /streaming/rooms/:roomId/gifts
Authorization: Bearer <token>
Content-Type: application/json

{
  "fromUserId": "user1",
  "toUserId": "user2",
  "amount": 100
}
```

### WebSocket API

Connect to: `ws://localhost:3006/streaming/ws`

#### Authentication
Include JWT token in `Authorization: Bearer <token>` header.

#### Message Types

**Join Room**
```json
{
  "type": "join-room",
  "data": {
    "roomId": "room-id"
  }
}
```

**Create Transport**
```json
{
  "type": "create-transport",
  "data": {
    "roomId": "room-id",
    "producing": true,
    "consuming": true
  }
}
```

**Connect Transport**
```json
{
  "type": "connect-transport",
  "data": {
    "roomId": "room-id",
    "transportId": "transport-id",
    "dtlsParameters": { ... }
  }
}
```

**Produce (Send Audio/Video)**
```json
{
  "type": "produce",
  "data": {
    "roomId": "room-id",
    "transportId": "transport-id",
    "kind": "video",
    "rtpParameters": { ... }
  }
}
```

**Consume (Receive Audio/Video)**
```json
{
  "type": "consume",
  "data": {
    "roomId": "room-id",
    "transportId": "transport-id",
    "producerId": "producer-id",
    "rtpCapabilities": { ... }
  }
}
```

**Start Broadcast**
```json
{
  "type": "start-broadcast",
  "data": {
    "roomId": "room-id"
  }
}
```

**Join as Viewer**
```json
{
  "type": "join-as-viewer",
  "data": {
    "roomId": "room-id"
  }
}
```

**Chat Message**
```json
{
  "type": "chat-message",
  "data": {
    "roomId": "room-id",
    "message": "Hello!"
  }
}
```

## Integration with Discovery Service

The streaming service integrates with the discovery-service and user-service to:

1. **Status Validation**: Only users with `MATCHED` status can create/join rooms
2. **Room Creation**: When users enter a room, their status changes from `MATCHED` → `IN_SQUAD`
3. **Status Updates**: When broadcasting starts, user statuses are updated to `IN_BROADCAST`
4. **Call End**: When a call ends, all participants are updated to `AVAILABLE`

### User Status Flow & Business Rules

**Valid Status Transitions:**
1. **Discovery/Matching Phase:**
   - Users with status: `AVAILABLE`, `IN_SQUAD_AVAILABLE`, or `IN_BROADCAST_AVAILABLE`
   - → Discovery service matches them → Status becomes `MATCHED`

2. **Room Creation/Join:**
   - Only users with status `MATCHED` can create or join rooms
   - When room is created/joined → Status changes: `MATCHED` → `IN_SQUAD`

3. **Broadcasting:**
   - When broadcast starts → Status changes: `IN_SQUAD` → `IN_BROADCAST`

4. **Call End:**
   - When call ends → Status changes: `IN_SQUAD`/`IN_BROADCAST` → `AVAILABLE`

**Validation Rules:**
- ✅ Users must be in `MATCHED` status to create/join rooms (enforced)
- ✅ Users can only be in ONE active room at a time (enforced)
- ✅ Users cannot create multiple rooms simultaneously (enforced)

### Integration Flow

1. Discovery service matches users and sets status to `MATCHED`
2. Frontend calls `POST /streaming/rooms` with matched user IDs
3. **Validation**: Service checks all users have `MATCHED` status
4. Room is created and user statuses change to `IN_SQUAD`
5. Participants can join via WebSocket
6. When broadcasting starts, status is updated to `IN_BROADCAST`
7. Viewers can join the broadcast
8. When call ends, all users are set back to `AVAILABLE`

## File Structure

```
apps/streaming-service/
├── src/
│   ├── main.ts                    # NestJS bootstrap
│   ├── modules/
│   │   └── app.module.ts         # Main module
│   ├── controllers/
│   │   ├── streaming.controller.ts
│   │   ├── dare.controller.ts
│   │   └── gift.controller.ts
│   ├── gateways/
│   │   └── streaming.gateway.ts  # WebSocket signaling
│   ├── services/
│   │   ├── mediasoup.service.ts   # SFU management
│   │   ├── room.service.ts       # Room lifecycle
│   │   ├── call.service.ts       # Call logic
│   │   ├── broadcast.service.ts  # Broadcasting
│   │   ├── chat.service.ts       # Chat messages
│   │   ├── dare.service.ts       # Dares feature
│   │   ├── gift.service.ts       # Gifts feature
│   │   ├── wallet-client.service.ts
│   │   └── discovery-client.service.ts
│   ├── filters/
│   │   └── zod-exception.filter.ts
│   └── prisma/
│       └── prisma.service.ts
├── prisma/
│   └── schema.prisma             # Database schema
└── package.json
```

## Database Schema

- `CallSession`: Room and call metadata
- `CallParticipant`: Core participants (2-4)
- `CallViewer`: Viewers watching broadcast
- `CallEvent`: Event log (join, leave, broadcast start/end)
- `CallDare`: Dare selections and completions
- `CallGift`: Gift transactions
- `CallMessage`: Chat messages

## Production Considerations

### Scaling
- **Mediasoup Workers**: 5-8 servers for 5K concurrent calls
- **Bandwidth**: ~33 TB/month for 5K calls (see plan for details)
- **Database**: Use read replicas for scaling reads
- **Caching**: Redis for room state (optional)

### Cost Optimization
- Adaptive bitrate for viewers
- Selective forwarding (only active speakers)
- Compression optimization
- Auto-scaling during low-traffic hours

### Security
- JWT authentication on WebSocket connections
- Authorization checks (verify user is in room)
- Rate limiting on signaling endpoints
- Input validation on all WebSocket messages
- Media encryption (DTLS/SRTP via WebRTC)

## Testing

### Local Testing
1. Start the service: `npm run start:dev`
2. Connect multiple WebSocket clients
3. Test 2-4 person calls
4. Test broadcasting with viewers
5. Test in-call features (dares, gifts, chat)

### Production Testing
1. Load testing with 100-500 concurrent calls
2. Viewer load testing
3. Stress testing (failure scenarios)
4. Performance monitoring (bandwidth, server load)

## Troubleshooting

### Mediasoup Workers Not Starting
- Check system dependencies are installed
- Verify `MEDIASOUP_ANNOUNCED_IP` is set correctly
- Check firewall allows RTP ports (40000-49999)

### WebSocket Connection Fails
- Verify JWT token is valid
- Check CORS settings
- Ensure WebSocket plugin is registered

### High Bandwidth Usage
- Enable adaptive bitrate
- Use selective forwarding
- Optimize video codec settings

## License

Private - hmmchat.live
