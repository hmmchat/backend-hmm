# How Video Calls Work - Explained Simply

## The Big Picture

Think of a video call like a video conference room:

1. **Room Creation** = Setting up a meeting room
2. **WebSocket** = Walkie-talkie to coordinate with the server
3. **WebRTC** = Direct video/audio connections between participants
4. **Mediasoup** = The smart router that manages all video streams

---

## Step-by-Step: How You See Yourself in a Video Call

### Step 1: Users Get Matched (Discovery Service)
**What happens:**
- User1 and User2 both click "Find Match"
- Discovery service matches them together
- Both users' status becomes `MATCHED`
- They're ready to start a call

**Frontend action:** Show "Matched!" screen with countdown or "Join Call" button

---

### Step 2: Create the "Room" (Backend)
**What happens:**
- Frontend sends: `POST /streaming/rooms` with `["user1", "user2"]`
- Backend creates a "room" (like reserving a meeting room)
- Backend sets up a router (Mediasoup router) - this is like the central hub
- Backend returns `roomId`

**Frontend action:** Store the `roomId`, you'll need it for everything

---

### Step 3: Connect the "Walkie-Talkie" (WebSocket)
**What happens:**
- Frontend opens WebSocket: `ws://localhost:3005/streaming/ws?userId=user1`
- This is like a walkie-talkie to talk to the server
- You use this to send commands: "I want to join", "I want to leave", etc.
- Server uses this to tell you: "New person joined", "Here's the stream info", etc.

**Frontend action:** Keep this WebSocket connection alive throughout the call

---

### Step 4: Join the Room (Tell Server You're Here)
**What happens:**
- Frontend sends via WebSocket: `{"type": "join-room", "data": {"roomId": "..."}}`
- Server responds: "Here's what video/audio formats I support" (RTP capabilities)
- Server adds you to the room's participant list

**Frontend action:** Save the RTP capabilities - you'll need this for video setup

---

### Step 5: Set Up Your "Video Camera" (Create Transport)
**What happens:**
- Frontend sends: `{"type": "create-transport", ...}`
- Server creates a "transport" - think of it as a pipe to send/receive video
- Server responds: "Here's your pipe details" (ICE parameters, DTLS parameters)
- These parameters are like the "address" and "security code" for your pipe

**Frontend action:** 
- Use WebRTC library (like Mediasoup Client) to create a transport
- Pass the server's parameters to your WebRTC library
- The library handles all the complex WebRTC stuff

---

### Step 6: Connect Your Pipe (Connect Transport)
**What happens:**
- Your WebRTC library creates a connection using the transport details
- It finds the best network path (ICE candidates)
- It establishes secure connection (DTLS handshake)
- Frontend sends: `{"type": "connect-transport", ...}` with connection details

**Frontend action:** Let your WebRTC library handle this, just send the result to server

---

### Step 7: Turn On Your Camera/Mic (Produce Audio/Video)
**What happens:**
1. Browser asks user: "Can I use your camera and microphone?"
2. User allows → Browser gives you video/audio stream
3. Frontend sends: `{"type": "produce", "kind": "video", ...}`
4. Server creates a "producer" - this is your outgoing video stream
5. Server tells other participants: "Hey, user1 is now streaming video!"
6. Repeat for audio

**Frontend action:**
- Use browser API (`getUserMedia`) to get camera/mic
- Feed the stream to your WebRTC library
- WebRTC library encodes it and sends to server
- Display your own video in a "local video" element

---

### Step 8: See Other People (Consume Their Streams)
**What happens:**
1. Server sends you: `{"type": "new-producer", "userId": "user2", "kind": "video"}`
2. Frontend sends: `{"type": "consume", "producerId": "...", ...}`
3. Server creates a "consumer" - this is their incoming video stream
4. Server responds: "Here's user2's video stream details"
5. WebRTC library receives the stream and decodes it
6. You display it in a "remote video" element

**Frontend action:**
- When you get `new-producer` event, send `consume` message
- Use WebRTC library to receive the stream
- Display each participant's video in separate video elements

---

## The Complete Flow (Simple Version)

```
1. User clicks "Start Call"
   ↓
2. Create room (REST API)
   ↓
3. Connect WebSocket
   ↓
4. Join room (WebSocket message)
   ↓
5. Create transport (WebSocket message)
   ↓
6. Connect transport (WebSocket message)
   ↓
7. Get camera/mic (Browser API)
   ↓
8. Send your video (WebSocket "produce" message)
   ↓
9. Receive other people's video (WebSocket "consume" message)
   ↓
10. Display videos on screen (Browser video elements)
    ↓
    ✅ YOU SEE YOURSELF AND OTHERS IN A VIDEO CALL!
```

---

## Why It's Complex

**The complexity comes from:**
1. **WebRTC** - Browser-based video/audio is complicated (network traversal, encoding, etc.)
2. **Mediasoup** - SFU architecture means server routes streams (not peer-to-peer)
3. **Multiple Steps** - Each step depends on the previous one
4. **State Management** - Tracking transports, producers, consumers, room state

**But the concept is simple:**
- You send your video to server
- Server sends other people's videos to you
- WebRTC library handles all the technical stuff
- You just display the video streams

---

## What Each Component Does

### Backend (Streaming Service)
- **Creates and manages rooms** - "Where are we meeting?"
- **Coordinates participants** - "Who's in the call?"
- **Manages the router** - "How do we route video streams?"
- **Handles signaling** - "Here's how to connect, here's who joined"

### WebSocket
- **Control channel** - Sending commands and receiving updates
- **Signaling** - Exchanging connection information
- **Events** - Notifications about what's happening

### WebRTC Library (Mediasoup Client)
- **Handles browser APIs** - Getting camera/mic
- **Encodes/decodes video** - Converting camera data to network data
- **Manages connections** - Network traversal, ICE, DTLS
- **Creates tracks** - Video/audio tracks that you display

### Frontend
- **Orchestrates everything** - Tells backend what to do
- **Displays video** - Shows video streams in UI
- **Manages state** - Who's in call, who's speaking, etc.
- **Handles user actions** - Mute, leave, chat, etc.

---

## Real-World Analogy

**Think of it like a video production studio:**

1. **Room Creation** = Booking a studio
2. **WebSocket** = Walkie-talkie to director
3. **Transport** = Camera cable
4. **Producer** = Your camera sending video
5. **Consumer** = Monitor showing other people's video
6. **Router** = Video switcher that routes feeds
7. **Mediasoup** = The technical crew managing everything

**You (Frontend):**
- Tell the director (via walkie-talkie) what you want
- Set up your camera (create transport, produce)
- Watch monitors (consume, display)

**Backend:**
- Manages the studio (room)
- Coordinates everyone (WebSocket)
- Routes video feeds (Mediasoup router)
- Handles all the technical routing

---

## Key Things to Remember

1. **WebSocket is for commands** - "Join room", "Send video", "Leave"
2. **WebRTC is for actual video** - The actual video/audio data flows through WebRTC
3. **Two separate channels:**
   - WebSocket = Control/signaling (lightweight, text messages)
   - WebRTC = Media/data (heavy, video/audio streams)
4. **Everything is async** - Send message → Wait for response → Do next step
5. **State matters** - You need to track room, participants, producers, consumers

---

## What You Need to Build

### Frontend Components:
1. **Room Manager** - Handles room creation, joining, leaving
2. **WebSocket Manager** - Manages connection, sends/receives messages
3. **WebRTC Manager** - Handles transports, producers, consumers
4. **Video Display** - Shows local and remote video streams
5. **UI Controls** - Mute, camera on/off, leave button, chat

### Integration Points:
1. **Discovery Service** - Get matched users before creating room
2. **User Service** - Track user status (MATCHED, IN_SQUAD, etc.)
3. **Streaming Service** - Handle all video call functionality

---

## Summary

**To see yourself in a video call:**

1. Get matched with other users
2. Create a room (backend reserves space)
3. Connect WebSocket (your control channel)
4. Join room (tell server you're here)
5. Set up WebRTC transport (your video pipe)
6. Turn on camera/mic (get browser stream)
7. Send your stream (produce)
8. Receive others' streams (consume)
9. Display all streams on screen

**The magic happens when:**
- Your WebRTC library sends your video to the server
- Server routes it to other participants
- Their WebRTC libraries receive it
- Everyone displays everyone else's video

**You're done when:**
- You see yourself in one video element
- You see other participants in other video elements
- Everyone can hear and see each other
- Chat works
- People can join/leave

That's how you get from "Create Room" API call to actually seeing yourself and others in a real video call! 🎥

