# Streaming Service Business Rules

## User Status Flow

### Valid Status Transitions

```
AVAILABLE ──┐
            ├──→ MATCHED ──→ IN_SQUAD ──→ IN_BROADCAST
IN_SQUAD_AVAILABLE ──┘                    │        │
IN_BROADCAST_AVAILABLE ───┘               │        │
                                          │        │
                                          └────────┴──→ AVAILABLE
                                          (user leaves / call ends)
                                          (back to discovery pool)
```

### Detailed Flow

1. **Discovery/Matching Phase** (Discovery Service):
   - Users with status: `AVAILABLE`, `IN_SQUAD_AVAILABLE`, or `IN_BROADCAST_AVAILABLE`
   - Discovery service matches users → Status becomes `MATCHED`
   - **Rule**: Only these three statuses can transition to `MATCHED`

2. **Room Creation/Join** (Streaming Service):
   - **Rule**: Only users with status `MATCHED` can create or join rooms
   - When room is created → Status changes: `MATCHED` → `IN_SQUAD`
   - **Validation**: Service checks user status before allowing room creation

3. **Broadcasting**:
   - When broadcast starts → Status changes: `IN_SQUAD` → `IN_BROADCAST`
   - Viewers can join (their status becomes `IN_BROADCAST`)

4. **User Leaves Room**:
   - When individual user leaves → Status changes: `IN_SQUAD`/`IN_BROADCAST` → `AVAILABLE`
   - User returns to discovery pool (status: `AVAILABLE`) and can be matched again
   - **API**: WebSocket message `leave-room` with `{ roomId }`
   - **If 1 participant remains**: Room continues - single user can stay in the room
   - **If 0 participants remain**: Room is automatically ended

5. **Call End**:
   - When entire room ends → Status changes: `IN_SQUAD`/`IN_BROADCAST` → `AVAILABLE`
   - Users return to discovery pool (status: `AVAILABLE`) and can be matched again

**Note on Status `AVAILABLE`**: This is the status for users in the discovery pool - they are available to be matched by the discovery service.

## Implemented Validations

### ✅ Room Creation Validation

**Location**: `room.service.ts::createRoom()`

**Validations:**
1. ✅ Minimum 2 users, maximum 4 users (to CREATE a room)
2. ✅ No duplicate user IDs
3. ✅ **Users must have `MATCHED` status** (enforced in production, skipped in TEST_MODE)
4. ✅ **Users cannot be in multiple active rooms** (enforced)

**Important**: 
- Single users CANNOT create rooms - rooms are only created when 2 users accept each other's cards
- However, once a room exists, if only 1 participant remains (others leave), that single user CAN stay in the room
- Room only auto-ends when 0 participants remain

**Error Messages:**
- If users not MATCHED: `"Users must be in MATCHED status to create/join rooms. Invalid users: X, Y"`
- If users already in room: `"Users X, Y are already in an active room. Please leave the current room before creating a new one."`

### ✅ Adding Participants Validation

**Location**: `room.service.ts::addParticipant()`

**Validations:**
1. ✅ Room must exist
2. ✅ Room not full (max 4 participants)
3. ✅ User not already in room
4. ✅ **User must have `MATCHED` status** (enforced in production, skipped in TEST_MODE)

### ✅ Status Updates

**Location**: `discovery-client.service.ts`

**Updates:**
1. ✅ Room created → Users: `MATCHED` → `IN_SQUAD`
2. ✅ Broadcast started → Participants: `IN_SQUAD` → `IN_BROADCAST`
3. ✅ User leaves room → User: `IN_SQUAD`/`IN_BROADCAST` → `AVAILABLE` (back to discovery pool)
4. ✅ Call ended → All users: `IN_SQUAD`/`IN_BROADCAST` → `AVAILABLE` (back to discovery pool)

## TEST_MODE Behavior

**In TEST_MODE (`TEST_MODE=true`):**
- ✅ Status validation is **SKIPPED** - allows testing without user-service
- ✅ Users can create rooms regardless of status
- ✅ All other validations still apply (duplicate users, room limits, etc.)

**In Production:**
- ✅ **ALL validations are enforced**
- ✅ User status must be `MATCHED` to create/join rooms
- ✅ Status checks fail if user-service is unavailable

## Current Implementation Status

### ✅ Implemented

- [x] Validate users are not already in active rooms
- [x] Validate user status is MATCHED (production mode)
- [x] Update status to IN_SQUAD on room creation
- [x] Update status to IN_BROADCAST on broadcast start
- [x] Update status to AVAILABLE when user leaves room (back to discovery pool)
- [x] Update status to AVAILABLE when call ends (back to discovery pool)
- [x] Auto-end room when last participant leaves
- [x] Skip status validation in TEST_MODE

### ⚠️ Requires Discovery/User Service

- [ ] Discovery service must set users to MATCHED status after matching
- [ ] User service must be running to validate status in production
- [ ] Status updates require user-service API to be available

## Testing the Rules

### In TEST_MODE (Current)

Since TEST_MODE skips status validation, you can:
- Create multiple rooms with same users (allowed for testing)
- Test all features without status checks
- Simulate any status scenario

### In Production

To test production behavior:
1. Set `TEST_MODE=false` or remove it
2. Ensure user-service is running
3. Set users to `MATCHED` status via user-service
4. Try creating rooms - will validate status
5. Try creating room with non-MATCHED users - will fail

## API Endpoints Used

- **Get User Status**: `GET /users/test/:userId?fields=status` (user-service)
- **Update User Status**: `PATCH /users/test/:userId/status` (user-service)

## Notes

- Status validation uses user-service API
- If user-service is unavailable in production, room creation will fail
- In TEST_MODE, assumes users are MATCHED if user-service unavailable
- Status updates are async (non-blocking) to prevent room creation failures

