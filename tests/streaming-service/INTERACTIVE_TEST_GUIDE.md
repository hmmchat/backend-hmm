# Interactive Testing Guide for Streaming Service

## Overview

This guide provides step-by-step instructions for testing the streaming service using the interactive browser-based test tool. The tool allows you to test all features without authentication (TEST_MODE).

## Important Business Rules

**User Status Flow:**
1. Users with status `AVAILABLE` (discovery pool), `IN_SQUAD_AVAILABLE`, or `IN_BROADCAST_AVAILABLE` can be matched by discovery service
2. Matched users get status `MATCHED`
3. **Only users with status `MATCHED` can create/join rooms** (enforced in production)
4. When users enter a room, status changes: `MATCHED` → `IN_SQUAD`
5. When broadcast starts, status changes: `IN_SQUAD` → `IN_BROADCAST`
6. When user leaves room or call ends, status changes: `IN_SQUAD`/`IN_BROADCAST` → `AVAILABLE` (back to discovery pool)

**Note on `AVAILABLE` status**: This is the status for users in the discovery pool - they are available to be matched by the discovery service.

**Note:** In `TEST_MODE`, status validation is **skipped** to allow easier testing. In production, these rules are strictly enforced.

## Prerequisites

### 1. Start the Streaming Service

Make sure the streaming service is running with TEST_MODE enabled:

```bash
cd apps/streaming-service
TEST_MODE=true npm run start:dev
```

You should see output like:
```
⚠️  TEST MODE ENABLED - Authentication is bypassed
🚀 Application is running on: http://localhost:3005
```

### 2. Open the Test Tool

Open the HTML file in your browser:

```bash
# On macOS
open tests/streaming-service/interactive-test.html

# On Linux
xdg-open tests/streaming-service/interactive-test.html

# Or simply navigate to the file in your browser
```

The tool will automatically test the connection on load.

## Test Cases - Step by Step

### Test Case 1: Basic Room Creation & Join Flow

**Objective**: Verify that rooms can be created and users can join via WebSocket.

**Steps**:
1. In the "Room Management" section, enter user IDs: `user1, user2`
2. Click **"Create Room"**
3. ✅ Verify: Log shows "Room created! Room ID: [uuid]"
4. Note the Room ID (it's also auto-filled in the fields)
5. In "User Connection" section, enter User ID: `user1`
6. Click **"Connect User"**
7. ✅ Verify: Log shows "Connected as user: user1" and status shows "Connected"
8. Enter the Room ID in "Room ID to Join" field (should be auto-filled)
9. Click **"Join Room"**
10. ✅ Verify: Log shows received message with type "room-joined" and RTP capabilities
11. Repeat steps 5-10 for `user2`
12. ✅ Verify: Both users are connected and joined the room

**Expected Results**:
- Room created successfully with unique ID
- Both users can connect via WebSocket
- Both users receive "room-joined" message with RTP capabilities
- Users list shows both users as connected

---

### Test Case 2: Chat Functionality

**Objective**: Verify that users can send chat messages and retrieve chat history.

**Steps**:
1. Complete Test Case 1 first (room created, 2 users joined)
2. Ensure `user1` is connected (if not, connect and join room)
3. Type a message in the "Chat Messages" section: `Hello, this is user1!`
4. Click **"Send Chat Message"**
5. ✅ Verify: Log shows "Sent: chat-message" and received "chat-message" response
6. Click **"Get Chat History"** button
7. ✅ Verify: Chat history shows the message with user ID and content
8. Connect `user2` (if not already connected) and join the room
9. Type another message as `user2`: `Hi user1, this is user2!`
10. Send the message
11. Get chat history again
12. ✅ Verify: Both messages appear in chronological order

**Expected Results**:
- Messages are sent successfully via WebSocket
- Messages are persisted in database
- Chat history API returns all messages
- Messages are broadcasted to other users in the room

---

### Test Case 3: Broadcasting Flow

**Objective**: Verify that participants can start broadcasting and viewers can join.

**Steps**:
1. Create a room with `user1, user2`
2. Connect and join both users as participants (complete Test Case 1)
3. With `user1` selected, click **"Start Broadcast"**
4. ✅ Verify: Log shows "broadcast-started" message
5. Click **"Get Room Info"** button
6. ✅ Verify: Room status is "IN_BROADCAST" and isBroadcasting is true
7. Connect a new user: `viewer1`
8. ✅ Verify: User connects successfully
9. With `viewer1` selected, enter the room ID and click **"Join as Viewer"**
10. ✅ Verify: Log shows "viewer-joined" message
11. Get room info again
12. ✅ Verify: Viewer count has increased

**Expected Results**:
- Participants can start broadcasting
- Room status changes to IN_BROADCAST
- Viewers can join broadcasting rooms
- Viewer count is tracked correctly

---

### Test Case 4: Dares Feature

**Objective**: Verify that dares list can be retrieved and dares can be selected.

**Steps**:
1. Create a room with at least 1 user
2. Have at least 1 user connected and joined (complete Test Case 1)
3. Click **"Get Dares"** button
4. ✅ Verify: Log shows list of 10 available dares with IDs and text
5. Note one dare ID (e.g., "dare-1")
6. Use browser console or REST client to select a dare:
   ```javascript
   fetch('http://localhost:3005/streaming/rooms/[ROOM_ID]/dares/select', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({
       dareId: 'dare-1',
       userId: 'user1'
     })
   }).then(r => r.json()).then(console.log)
   ```
7. ✅ Verify: Dare selection is successful

**Expected Results**:
- Dare list API returns 10 predefined dares
- Dares can be selected for a room
- Selected dares are tracked in database

---

### Test Case 5: Multiple Users & Concurrent Operations

**Objective**: Verify system handles multiple users and concurrent operations correctly.

**Steps**:
1. Create a room with maximum 4 users: `user1, user2, user3, user4`
2. ✅ Verify: Room created successfully
3. Connect all 4 users one by one
4. ✅ Verify: All 4 users connect successfully
5. Have all users join the room
6. ✅ Verify: All users receive "room-joined" messages
7. As `user1`, send message: `Message 1 from user1`
8. As `user2`, send message: `Message 2 from user2`
9. As `user3`, send message: `Message 3 from user3`
10. As `user4`, send message: `Message 4 from user4`
11. Get chat history
12. ✅ Verify: All 4 messages appear in chronological order
13. Check users list
14. ✅ Verify: All 4 users shown as connected

**Expected Results**:
- System supports maximum 4 participants
- All users can connect and join simultaneously
- All messages are processed correctly
- No race conditions or data loss

---

### Test Case 6: Error Handling

**Objective**: Verify that validation and error handling work correctly.

**Steps**:
1. Try creating room with 1 user: `user1`
   - ✅ Expected: Error - "Room must have between 2 and 4 participants"

2. Try creating room with 5 users: `user1, user2, user3, user4, user5`
   - ✅ Expected: Error - "Room must have between 2 and 4 participants"

3. Try creating room with duplicate user IDs: `user1, user1`
   - ✅ Expected: Error - "Duplicate user IDs are not allowed"

4. Create a valid room, then try joining with invalid room ID: `invalid-room-id`
   - ✅ Expected: Error message via WebSocket

5. Try sending chat message without connecting user first
   - ✅ Expected: Error - "User is not connected"

6. Try sending chat message without joining room first
   - ✅ Expected: Error via WebSocket

7. Try joining as viewer when room is not broadcasting
   - ✅ Expected: Error - "Room is not broadcasting"

8. Try starting broadcast as a user who is not a participant
   - ✅ Expected: Error via WebSocket

**Expected Results**:
- All validation errors are caught and reported
- Error messages are clear and helpful
- System doesn't crash on invalid inputs

---

### Test Case 7: Leave Room Functionality

**Objective**: Verify that users can leave rooms and their status is updated correctly.

**Steps**:
1. Create a room with `user1, user2`
2. Connect both users (`user1` and `user2`)
3. Join both users to the room
4. Verify both users are in the room (check room info or logs)
5. In the "User Connection" section:
   - Set User ID to `user1`
   - Set Room ID to the created room ID
   - Click **"Leave Room"**
6. ✅ Verify: `user1` left the room (check logs for "Participant user1 removed")
7. ✅ Verify: `user1` status should be updated to `AVAILABLE` (back to discovery pool)
8. Get room info again
   - ✅ Verify: Participant count decreased (should be 1 now)
9. If `user2` was the last participant:
   - ✅ Verify: Room was automatically ended (no active participants)
   - ✅ Verify: `user2` status updated to `AVAILABLE`

**Expected Results**:
- Users can successfully leave rooms via `leave-room` WebSocket message
- User status changes to `AVAILABLE` (discovery pool) when leaving
- Room is auto-ended when last participant leaves
- All users return to `AVAILABLE` status when room ends
- Status updates are logged clearly

**Note**: The `leave-room` functionality is available via WebSocket. There is no REST API endpoint for leaving rooms - only the WebSocket message handler.

---

### Test Case 9: Quick Test Buttons

**Objective**: Verify quick test functions work correctly.

**Steps**:
1. Click **"Test 1: Basic Room Flow"**
   - ✅ Verify: Room created, user1 connected and joined

2. Click **"Test 2: Chat Messages"**
   - ✅ Verify: Message sent and chat history retrieved

3. Click **"Test 3: Broadcasting"**
   - ✅ Verify: Broadcast started and room info retrieved

**Expected Results**:
- Quick tests execute successfully
- Provide good starting point for manual testing

---

## Advanced Testing Scenarios

### Scenario A: Multiple Rooms Simultaneously

1. Create Room A with `user-a1, user-a2`
2. Create Room B with `user-b1, user-b2`
3. Connect users for both rooms
4. Have users join their respective rooms
5. Send messages in both rooms
6. ✅ Verify: Messages are isolated to their rooms

### Scenario B: Viewer Join/Leave Flow

1. Create room and start broadcast
2. Join 3 viewers: `viewer1, viewer2, viewer3`
3. ✅ Verify: All viewers can join
4. Get room info - viewer count should be 3
5. Disconnect one viewer
6. ✅ Verify: Viewer count decreases (may need room info refresh)

### Scenario C: Participant Leaves

1. Create room with 3 participants
2. All participants join
3. Disconnect one participant
4. ✅ Verify: Room still functions for remaining participants

---

## Troubleshooting

### Connection Issues

**Problem**: "Connection failed" when testing connection
- **Solution**: Ensure streaming-service is running with `TEST_MODE=true`
- Check the service URL is correct (default: http://localhost:3005)
- Check browser console for CORS errors (shouldn't happen in TEST_MODE)

### WebSocket Connection Fails

**Problem**: User cannot connect via WebSocket
- **Solution**: 
  - Check WebSocket URL (default: ws://localhost:3005/streaming/ws)
  - Ensure service is running
  - Check browser console for WebSocket errors
  - Try refreshing the page

### Messages Not Received

**Problem**: Sent messages but no response
- **Solution**:
  - Ensure user is connected (status shows "Connected")
  - Ensure user has joined the room
  - Check room ID is correct
  - Look at server logs for errors

### Room Not Found

**Problem**: "Room not found" errors
- **Solution**:
  - Verify room ID is correct (copy from creation log)
  - Ensure room was created successfully
  - Room IDs are UUIDs - make sure you copied the full ID

---

## Tips for Frontend Integration

1. **WebSocket Connection**: Use the same WebSocket URL format: `ws://localhost:3005/streaming/ws?userId={userId}` (in TEST_MODE)

2. **Message Format**: All WebSocket messages follow this format:
   ```json
   {
     "type": "message-type",
     "data": { ... }
   }
   ```

3. **Error Handling**: Always check response type for "error" and handle accordingly

4. **State Management**: Track:
   - Connection status
   - Current room ID
   - Joined users
   - Chat messages
   - Broadcasting status

5. **Testing Flow**: Follow the same sequence:
   - Create room (REST API)
   - Connect WebSocket
   - Join room (WebSocket)
   - Send messages (WebSocket)
   - Query state (REST API)

---

## API Reference

### REST Endpoints

- `POST /streaming/rooms` - Create room
  ```json
  { "userIds": ["user1", "user2"] }
  ```

- `GET /streaming/rooms/:roomId` - Get room info

- `GET /streaming/rooms/:roomId/chat` - Get chat history

- `GET /streaming/rooms/:roomId/dares` - Get dares list

- `POST /streaming/rooms/:roomId/dares/select` - Select dare
  ```json
  { "dareId": "dare-1", "userId": "user1" }
  ```

### WebSocket Messages

- `join-room`: Join a room as participant
- `chat-message`: Send chat message
- `start-broadcast`: Start broadcasting
- `join-as-viewer`: Join as viewer

See the HTML file for complete message formats.

---

## Next Steps

After completing these tests:

1. ✅ Verify all features work as expected
2. ✅ Test edge cases and error handling
3. ✅ Document any issues found
4. ✅ Share test results with team
5. ✅ Provide frontend team with this guide

---

**Happy Testing! 🚀**

