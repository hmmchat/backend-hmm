# Frontend Integration Guide

This document provides examples for integrating the streaming-service with your frontend application.

## WebSocket Connection

Connect to the WebSocket endpoint for real-time signaling:

```javascript
const ws = new WebSocket('ws://localhost:3005/streaming/ws');

ws.onopen = () => {
  console.log('WebSocket connected');
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  handleMessage(message);
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};

ws.onclose = () => {
  console.log('WebSocket disconnected');
};
```

## Message Types

### Client to Server

#### Join Room
```json
{
  "type": "join-room",
  "data": {
    "roomId": "room-123",
    "userId": "user-456"
  }
}
```

#### Create Transport
```json
{
  "type": "create-transport",
  "data": {
    "roomId": "room-123",
    "userId": "user-456",
    "direction": "send" // or "recv"
  }
}
```

#### Connect Transport
```json
{
  "type": "connect-transport",
  "data": {
    "roomId": "room-123",
    "userId": "user-456",
    "transportId": "transport-789",
    "dtlsParameters": { /* DTLS parameters from WebRTC */ }
  }
}
```

#### Produce (Send Audio/Video)
```json
{
  "type": "produce",
  "data": {
    "roomId": "room-123",
    "userId": "user-456",
    "transportId": "transport-789",
    "kind": "audio", // or "video"
    "rtpParameters": { /* RTP parameters from WebRTC */ }
  }
}
```

#### Consume (Receive Audio/Video)
```json
{
  "type": "consume",
  "data": {
    "roomId": "room-123",
    "userId": "user-456",
    "transportId": "transport-789",
    "producerId": "producer-abc",
    "rtpCapabilities": { /* RTP capabilities from router */ }
  }
}
```

#### Get Producers
```json
{
  "type": "get-producers",
  "data": {
    "roomId": "room-123",
    "userId": "user-456"
  }
}
```

#### Leave Room
```json
{
  "type": "leave-room",
  "data": {}
}
```

### Server to Client

#### Room Joined
```json
{
  "type": "room-joined",
  "data": {
    "roomId": "room-123",
    "rtpCapabilities": { /* Router RTP capabilities */ }
  }
}
```

#### Transport Created
```json
{
  "type": "transport-created",
  "data": {
    "id": "transport-789",
    "iceParameters": { /* ICE parameters */ },
    "iceCandidates": [ /* ICE candidates */ ],
    "dtlsParameters": { /* DTLS parameters */ }
  }
}
```

#### Transport Connected
```json
{
  "type": "transport-connected",
  "data": {}
}
```

#### Produced
```json
{
  "type": "produced",
  "data": {
    "id": "producer-abc",
    "kind": "audio",
    "rtpParameters": { /* RTP parameters */ }
  }
}
```

#### Consumed
```json
{
  "type": "consumed",
  "data": {
    "id": "consumer-xyz",
    "producerId": "producer-abc",
    "kind": "audio",
    "rtpParameters": { /* RTP parameters */ }
  }
}
```

#### Producers List
```json
{
  "type": "producers",
  "data": [
    {
      "id": "producer-abc",
      "userId": "user-456",
      "kind": "audio"
    }
  ]
}
```

#### Error
```json
{
  "type": "error",
  "data": {
    "message": "Error message here"
  }
}
```

## REST API Endpoints

### Create Room
```javascript
POST /streaming/rooms
Content-Type: application/json

{
  "roomId": "room-123",
  "userId1": "user-456",
  "userId2": "user-789",
  "maxParticipants": 4
}
```

### Get Room
```javascript
GET /streaming/rooms/:roomId
```

### Add Participant
```javascript
POST /streaming/rooms/:roomId/participants
Content-Type: application/json

{
  "userId": "user-999",
  "role": "PARTICIPANT"
}
```

### Start Broadcast
```javascript
POST /streaming/rooms/:roomId/broadcast/start
```

### Stop Broadcast
```javascript
POST /streaming/rooms/:roomId/broadcast/stop
```

### End Call
```javascript
POST /streaming/rooms/:roomId/end
```

### Get Dares
```javascript
GET /streaming/rooms/:roomId/dares
```

### Select Dare
```javascript
POST /streaming/rooms/:roomId/dares/:dareId/select
Content-Type: application/json

{
  "userId": "user-456"
}
```

### Send Gift
```javascript
POST /streaming/rooms/:roomId/gifts
Content-Type: application/json

{
  "fromUserId": "user-456",
  "toUserId": "user-789",
  "amount": 100,
  "message": "Thanks for the call!"
}
```

### Send Chat Message
```javascript
POST /streaming/rooms/:roomId/chat/messages
Content-Type: application/json

{
  "userId": "user-456",
  "message": "Hello everyone!"
}
```

### Get Chat Messages
```javascript
GET /streaming/rooms/:roomId/chat/messages?limit=50
```

### Add Viewer
```javascript
POST /streaming/rooms/:roomId/viewers
Content-Type: application/json

{
  "userId": "user-999"
}
```

### Get Viewers
```javascript
GET /streaming/rooms/:roomId/viewers
```

## Example: Complete Call Flow

```javascript
// 1. Create room
const roomResponse = await fetch('http://localhost:3005/streaming/rooms', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    roomId: 'room-123',
    userId1: 'user-1',
    userId2: 'user-2'
  })
});

// 2. Connect WebSocket
const ws = new WebSocket('ws://localhost:3005/streaming/ws');

// 3. Join room
ws.send(JSON.stringify({
  type: 'join-room',
  data: { roomId: 'room-123', userId: 'user-1' }
}));

// 4. Wait for room-joined message with rtpCapabilities
// 5. Create send transport
ws.send(JSON.stringify({
  type: 'create-transport',
  data: { roomId: 'room-123', userId: 'user-1', direction: 'send' }
}));

// 6. Wait for transport-created, then connect transport with WebRTC
// 7. Produce audio/video
// 8. Get producers and consume from others
// 9. Handle in-call features (dares, gifts, chat)
```

## In-Call Features

### Dares
```javascript
// Get dare list
const dares = await fetch(`/streaming/rooms/${roomId}/dares`).then(r => r.json());

// Select a dare
await fetch(`/streaming/rooms/${roomId}/dares/${dareId}/select`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ userId: 'user-1' })
});
```

### Gifts
```javascript
// Send gift
await fetch(`/streaming/rooms/${roomId}/gifts`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    fromUserId: 'user-1',
    toUserId: 'user-2',
    amount: 100,
    message: 'Thanks!'
  })
});
```

### Chat
```javascript
// Send message
await fetch(`/streaming/rooms/${roomId}/chat/messages`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userId: 'user-1',
    message: 'Hello!'
  })
});

// Get messages
const messages = await fetch(`/streaming/rooms/${roomId}/chat/messages`).then(r => r.json());
```

## Broadcasting

### Start Broadcast
```javascript
await fetch(`/streaming/rooms/${roomId}/broadcast/start`, { method: 'POST' });
```

### Add Viewer
```javascript
await fetch(`/streaming/rooms/${roomId}/viewers`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ userId: 'viewer-1' })
});
```

### Get Viewer Count
```javascript
const { count } = await fetch(`/streaming/rooms/${roomId}/viewers/count`).then(r => r.json());
```

