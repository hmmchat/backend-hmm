# Streaming Service E2E Tests - Complete Documentation

## Overview

This document describes all E2E tests for the streaming-service, covering room management, WebSocket signaling, video calls, broadcasting, and in-call features. The tests are designed to be comprehensive, including edge cases and error scenarios.

## Test Execution

### Prerequisites

**The test script is fully automated and handles all setup!** You only need:

1. **PostgreSQL** running (the script will check this)
2. **Node.js** and **npm** installed

### Running Tests

**One-click execution** - the script will automatically:
- ✅ Clean up previous test data from database
- ✅ Setup database schema (Prisma migrations)
- ✅ Install dependencies if needed
- ✅ Start streaming-service if not running
- ✅ Run all 42 E2E tests

```bash
cd tests/streaming-service
./test-streaming-e2e.sh
```

The script will:
1. **Cleanup**: Remove all test rooms and related data from previous runs
2. **Database Setup**: Push Prisma schema to ensure tables exist
3. **Dependencies**: Install npm packages if missing
4. **Service Startup**: Start streaming-service with `TEST_MODE=true` if not running
5. **Testing**: Execute all 42 test cases
6. **Cleanup**: Stop the service when tests complete (if started by script)

### Manual Setup (Optional)

If you prefer to run the service manually:

```bash
# Terminal 1: Start streaming service
cd apps/streaming-service
TEST_MODE=true npm run start:dev

# Terminal 2: Run tests
cd tests/streaming-service
./test-streaming-e2e.sh
```

The script will detect if the service is already running and skip auto-start.

## Test Categories

### 1. Room Management Tests (Tests 1-5)

#### Test 1: Create Room (2 participants)
**Scenario**: Create a room with 2 users entering IN_SQUAD
- **Expected**: Room created with `roomId` and `sessionId`
- **Status**: `IN_SQUAD`
- **Participants**: 2

#### Test 2: Get Room Info
**Scenario**: Retrieve room details after creation
- **Expected**: Room exists, status is `IN_SQUAD`, participant count is 2
- **Validates**: Room state persistence

#### Test 3: Create Room - Invalid (1 user)
**Scenario**: Attempt to create room with only 1 user
- **Expected**: HTTP 400 - Room must have 2-4 participants
- **Edge Case**: Minimum participant validation

#### Test 4: Create Room - Invalid (5 users)
**Scenario**: Attempt to create room with 5 users
- **Expected**: HTTP 400 - Room cannot exceed 4 participants
- **Edge Case**: Maximum participant validation

#### Test 5: Get Non-Existent Room
**Scenario**: Query room that doesn't exist
- **Expected**: `exists: false`
- **Edge Case**: Error handling for invalid room IDs

---

### 2. WebSocket Connection Tests (Tests 6-8)

#### Test 6: WebSocket Connection (User 1)
**Scenario**: User 1 connects via WebSocket and joins room
- **Expected**: Connection established, `room-joined` message received
- **Validates**: RTP capabilities returned
- **Critical**: WebSocket authentication bypass in TEST_MODE

#### Test 7: WebSocket Connection (User 2)
**Scenario**: Second user connects to same room
- **Expected**: Both users can connect simultaneously
- **Validates**: Multiple concurrent WebSocket connections

#### Test 8: WebSocket - Invalid Room
**Scenario**: Attempt to join non-existent room via WebSocket
- **Expected**: Error message returned
- **Edge Case**: Invalid room ID handling in WebSocket

---

### 3. Participant Management Tests (Tests 9-10)

#### Test 9: Add 3rd Participant
**Scenario**: Add third person to existing 2-person call
- **Expected**: Room can accommodate 3 participants
- **Validates**: Dynamic participant addition
- **Note**: Full test requires WebSocket transport setup

#### Test 10: Add 4th Participant
**Scenario**: Create room with maximum 4 participants
- **Expected**: Room created with 4 participants
- **Validates**: Maximum capacity handling
- **Edge Case**: Room at maximum capacity

---

### 4. Chat Tests (Tests 11-14)

#### Test 11: Send Chat Message
**Scenario**: User sends chat message during call
- **Expected**: Message sent successfully
- **Validates**: Real-time chat functionality
- **Integration**: WebSocket message broadcasting

#### Test 12: Get Chat History
**Scenario**: Retrieve chat messages for a room
- **Expected**: Chat history returned with sent messages
- **Validates**: Message persistence in database
- **Edge Case**: Empty chat history handling

#### Test 13: Chat Message - Empty
**Scenario**: Attempt to send empty chat message
- **Expected**: Error - message cannot be empty
- **Edge Case**: Input validation

#### Test 14: Chat Message - Too Long
**Scenario**: Attempt to send message > 1000 characters
- **Expected**: Error - message too long
- **Edge Case**: Maximum length validation (1000 chars)

---

### 5. Dares Tests (Tests 15-19)

#### Test 15: Get Dare List
**Scenario**: Retrieve list of available dares
- **Expected**: List of 10 predefined dares returned
- **Validates**: Dare catalog functionality

#### Test 16: Select Dare
**Scenario**: Participant selects a dare from the list
- **Expected**: Dare selection recorded in database
- **Validates**: Dare tracking per room

#### Test 17: Get Room Dares History
**Scenario**: View all dares selected in a room
- **Expected**: List of selected dares with status
- **Validates**: Dare history persistence

#### Test 18: Perform Dare
**Scenario**: Mark a selected dare as performed
- **Expected**: Dare status updated to "performed"
- **Validates**: Dare completion tracking

#### Test 19: Select Invalid Dare
**Scenario**: Attempt to select non-existent dare ID
- **Expected**: HTTP 404 - Dare not found
- **Edge Case**: Invalid dare ID validation

---

### 6. Broadcasting Tests (Tests 20-22)

#### Test 20: Start Broadcast
**Scenario**: Core participants enable broadcasting mode
- **Expected**: Room status changes to `IN_BROADCAST`
- **Validates**: Status transition from IN_SQUAD to IN_BROADCAST
- **Integration**: Discovery service status update

#### Test 21: Join as Viewer
**Scenario**: Viewer joins the broadcast
- **Expected**: Viewer added, `viewer-joined` message received
- **Validates**: Viewer count updated
- **Edge Case**: Unlimited viewers support

#### Test 22: Join as Viewer - Room Not Broadcasting
**Scenario**: Attempt to join as viewer when room is not broadcasting
- **Expected**: Error - room is not broadcasting
- **Edge Case**: Viewer join validation

---

### 7. Gifts Tests (Tests 23-26)

#### Test 23: Send Gift (Test Mode)
**Scenario**: Participant sends gift (coins) to another participant
- **Expected**: Gift transaction created (may fail if wallet-service unavailable)
- **Validates**: Gift API endpoint
- **Integration**: Wallet service integration
- **Note**: In test mode, wallet-service may not be available

#### Test 24: Get Room Gifts
**Scenario**: Retrieve all gifts sent in a room
- **Expected**: List of gift transactions
- **Validates**: Gift history persistence

#### Test 25: Send Gift - Invalid Amount
**Scenario**: Attempt to send negative or zero amount
- **Expected**: HTTP 400 - Amount must be positive
- **Edge Case**: Amount validation

#### Test 26: Send Gift - Self Gift
**Scenario**: Attempt to send gift to oneself
- **Expected**: HTTP 400 - Cannot send gift to yourself
- **Edge Case**: Self-gift prevention

---

### 8. Edge Cases (Tests 27-40)

#### Test 27: Multiple Rooms Simultaneously
**Scenario**: Create multiple rooms at the same time
- **Expected**: All rooms created successfully with unique IDs
- **Validates**: Concurrent room creation handling
- **Edge Case**: Race conditions in room creation

#### Test 28: Duplicate User IDs in Room Creation
**Scenario**: Attempt to create room with same user ID twice
- **Expected**: Either rejected (400) or allowed (implementation-dependent)
- **Edge Case**: Duplicate user handling

#### Test 29: Chat in Non-Existent Room
**Scenario**: Attempt to send chat message to invalid room
- **Expected**: Error - room not found
- **Edge Case**: Invalid room ID in chat

#### Test 30: Concurrent Chat Messages
**Scenario**: Send multiple chat messages rapidly
- **Expected**: All messages processed and persisted
- **Validates**: Race condition handling in chat
- **Edge Case**: Concurrent message processing

#### Test 31: Room Lifecycle - End Room
**Scenario**: Room cleanup when call ends
- **Expected**: Room state properly cleaned up
- **Validates**: Resource cleanup
- **Note**: Full test requires WebSocket disconnect handling

#### Test 32: WebSocket - Invalid Message Type
**Scenario**: Send WebSocket message with unknown type
- **Expected**: Error message returned
- **Edge Case**: Invalid message type handling

#### Test 33: WebSocket - Malformed JSON
**Scenario**: Send malformed JSON via WebSocket
- **Expected**: Connection error or parse error
- **Edge Case**: JSON parsing error handling

#### Test 34: Room Full - Try to Add 5th Participant
**Scenario**: Attempt to add participant when room is at capacity (4)
- **Expected**: Rejection - room is full
- **Edge Case**: Maximum capacity enforcement

#### Test 35: Broadcast - Multiple Viewers
**Scenario**: Multiple viewers join the same broadcast
- **Expected**: All viewers can join successfully
- **Validates**: Scalability of viewer management
- **Edge Case**: High viewer count handling

#### Test 36: Participant Cannot Join as Viewer
**Scenario**: Core participant attempts to join as viewer
- **Expected**: Error - participants cannot join as viewers
- **Edge Case**: Role separation validation

#### Test 37: Dare Selection - User Not in Room
**Scenario**: User not in room attempts to select dare
- **Expected**: Either rejected or allowed (implementation-dependent)
- **Edge Case**: Authorization for dare selection

#### Test 38: Gift - User Not in Room
**Scenario**: User not in room attempts to send gift
- **Expected**: HTTP 400 - User not in room
- **Edge Case**: Authorization for gift sending

#### Test 39: Room State Persistence
**Scenario**: Verify room state persists across requests
- **Expected**: Chat messages and room data persist
- **Validates**: Database persistence
- **Edge Case**: State consistency

#### Test 40: Concurrent Room Creation
**Scenario**: Create 5 rooms simultaneously
- **Expected**: All rooms created successfully
- **Validates**: Concurrent request handling
- **Edge Case**: Database race conditions

---

### 9. Integration Tests (Tests 41-42)

#### Test 41: Room Creation Triggers Discovery Service Update
**Scenario**: When room is created, user statuses should update to IN_SQUAD
- **Expected**: Discovery service notified (if running)
- **Integration**: Discovery service status updates
- **Note**: Requires discovery-service running

#### Test 42: Broadcast Start Updates User Statuses
**Scenario**: When broadcast starts, user statuses should update to IN_BROADCAST
- **Expected**: User service statuses updated (if running)
- **Integration**: User service status management
- **Note**: Requires user-service running

---

## Test Coverage Summary

### Core Functionality
- ✅ Room creation and management
- ✅ WebSocket connections and signaling
- ✅ Participant management (2-4 users)
- ✅ Chat messaging
- ✅ Dares feature
- ✅ Broadcasting
- ✅ Viewer management
- ✅ Gifts (with wallet-service integration)

### Edge Cases Covered
- ✅ Invalid room creation (1 user, 5 users)
- ✅ Non-existent room handling
- ✅ Empty/long chat messages
- ✅ Invalid dare/gift IDs
- ✅ Room capacity limits
- ✅ Concurrent operations
- ✅ Malformed WebSocket messages
- ✅ Authorization checks
- ✅ State persistence
- ✅ Self-gift prevention

### Integration Points
- ✅ Discovery service (user status updates)
- ✅ User service (status management)
- ✅ Wallet service (gift transactions)

## Test Statistics

- **Total Tests**: 42
- **Room Management**: 5 tests
- **WebSocket**: 3 tests
- **Participants**: 2 tests
- **Chat**: 4 tests
- **Dares**: 5 tests
- **Broadcasting**: 3 tests
- **Gifts**: 4 tests
- **Edge Cases**: 14 tests
- **Integration**: 2 tests

## Test Scenarios by Priority

### Critical Path (Must Pass)
1. **Room Creation** (Test 1) - Core functionality
2. **WebSocket Connection** (Test 6) - Required for all features
3. **Chat Messaging** (Test 11) - Basic in-call feature
4. **Broadcasting** (Test 20) - Key feature
5. **Viewer Join** (Test 21) - Broadcasting functionality

### Important Features
- Participant management (Tests 9-10)
- Dares feature (Tests 15-18)
- Gifts feature (Tests 23-24)
- Room state persistence (Test 39)

### Edge Cases (Important for Production)
- Invalid inputs (Tests 3-4, 13-14, 19, 25-26)
- Concurrent operations (Tests 27, 30, 40)
- Authorization checks (Tests 36-38)
- Capacity limits (Test 34)

## Expected Behaviors

### Room Lifecycle
1. **Creation**: 2-4 users → Room created → Status: IN_SQUAD
2. **Broadcasting**: Start broadcast → Status: IN_BROADCAST → Viewers can join
3. **End**: All participants leave → Room cleaned up → Status: ENDED

### WebSocket Flow
1. **Connect**: `ws://localhost:3005/streaming/ws?userId=user-123`
2. **Join Room**: Send `{"type":"join-room","data":{"roomId":"..."}}`
3. **Receive**: `{"type":"room-joined","data":{"rtpCapabilities":{...}}}`
4. **Signaling**: Create transport, connect, produce, consume
5. **Features**: Chat, dares, gifts via WebSocket messages

### Error Handling
- **Invalid Room**: Returns error via WebSocket or HTTP 404
- **Invalid Message**: Returns `{"type":"error","data":{"error":"..."}}`
- **Validation Errors**: HTTP 400 with descriptive message
- **Service Unavailable**: HTTP 503 (e.g., wallet-service down)

## Known Limitations

1. **WebSocket Transport Testing**: Full WebRTC transport testing requires browser or specialized tools
2. **Mediasoup Workers**: System dependencies required for Mediasoup (not tested in script)
3. **Wallet Service**: Gift tests may fail if wallet-service is not running (expected)
4. **Discovery Service**: Integration tests require discovery-service running
5. **Concurrent Operations**: Some race conditions may not be fully testable via bash

## Troubleshooting

### Automated Setup Issues

1. **Service Failed to Start**: 
   - Check logs: `/tmp/streaming-service-test.log`
   - Verify PostgreSQL is running: `pg_isready`
   - Check if port 3005 is already in use: `lsof -i :3005`

2. **Database Schema Issues**:
   - Check Prisma logs: `/tmp/streaming-prisma-push.log`
   - Verify DATABASE_URL in `apps/streaming-service/.env`
   - Manually run: `cd apps/streaming-service && npx prisma db push`

3. **Dependencies Not Installing**:
   - Ensure npm is working: `npm --version`
   - Check network connectivity
   - Try manual install: `cd apps/streaming-service && npm install`

### Test Execution Issues

1. **Service Not Running**: The script should auto-start it, but if it fails:
   ```bash
   cd apps/streaming-service
   TEST_MODE=true npm run start:dev
   ```

2. **WebSocket Errors**: 
   - Check if `ws` package is installed (script installs automatically)
   - Verify WebSocket endpoint: `curl http://localhost:3005/streaming/ws`
   - Ensure TEST_MODE is enabled

3. **Database Errors**: 
   - Verify PostgreSQL is running: `pg_isready`
   - Check DATABASE_URL in `.env` file
   - Verify database exists: `psql -U postgres -l | grep hmm_streaming`

4. **Port Conflicts**: 
   - Ensure port 3005 is available: `lsof -i :3005`
   - Kill existing process if needed: `kill $(lsof -t -i:3005)`

5. **Test Data Not Cleaned**: 
   - The script cleans test data automatically
   - Manual cleanup: Connect to database and delete rows with `roomId LIKE 'test-%'`

### Common Issues

- **"Cannot POST /streaming/rooms"**: Service not fully started, wait a few seconds
- **WebSocket timeout**: Service may be slow, increase timeout in test script
- **"Room not found"**: Room may have been cleaned up, create new room
- **Gift tests failing**: Wallet-service not available (expected in test mode)

## Future Enhancements

1. **Load Testing**: Test with 100+ concurrent rooms
2. **WebRTC Testing**: Full video/audio call testing with browser automation
3. **Stress Testing**: Test system limits (max viewers, max rooms)
4. **Performance Testing**: Measure latency, bandwidth usage
5. **Failure Recovery**: Test service recovery after crashes

## Related Documentation

- **Service README**: `apps/streaming-service/README.md`
- **Architecture Plan**: See plan document for full architecture
- **API Documentation**: See service README for API endpoints

