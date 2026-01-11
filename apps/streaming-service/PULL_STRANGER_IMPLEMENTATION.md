# Pull Stranger Feature Implementation

## Overview

Implemented the "pull stranger" feature that allows users already in a call to add new participants without going through normal matching flow.

## Flow Verification

✅ **Your described flow is correct:**

1. **a, b in call (IN_SQUAD)**
   - Status: Both are `IN_SQUAD`

2. **a clicks pull stranger**
   - HOST (a) calls: `POST /streaming/rooms/:roomId/enable-pull-stranger`
   - Both a and b status change: `IN_SQUAD` → `IN_SQUAD_AVAILABLE`
   - `pullStrangerEnabled` flag set to `true` on room

3. **c sees a (matchmaking algo and scoring)**
   - Discovery service shows users with `IN_SQUAD_AVAILABLE` status
   - C sees A's card separately (and B's card separately)
   - When C accepts A's card, C gets `MATCHED` status (via discovery service)

4. **c accepts**
   - C calls: `POST /streaming/rooms/:roomId/join-via-pull-stranger`
   - C joins room directly (no mutual acceptance needed)
   - Status changes:
     - C: `MATCHED` → `IN_SQUAD`
     - A, B: `IN_SQUAD_AVAILABLE` → `IN_SQUAD` (or `IN_BROADCAST` if broadcasting)
   - `pullStrangerEnabled` flag set to `false`

5. **Pull stranger button available again**
   - Since `pullStrangerEnabled` is now `false`, HOST can enable it again
   - Room has 3 participants, can still add 1 more (max 4)

## Race Condition Handling

**Scenario: C sees A and E sees B, both accept simultaneously**

✅ **Solution: Database transaction with Serializable isolation level**

- Both C and E call `joinViaPullStranger` at the same time
- Transaction uses `Serializable` isolation level (highest isolation)
- Only ONE transaction will succeed:
  - First transaction (e.g., C's):
    1. Checks `pullStrangerEnabled` (true) ✓
    2. Adds participant to database ✓
    3. Sets `pullStrangerEnabled` to false ✓
    4. Updates statuses ✓
    5. Commits ✓
  - Second transaction (e.g., E's):
    1. Either sees `pullStrangerEnabled` as false (if C committed first) → **Fails with clear error**
    2. Or if E started before C committed, transaction will conflict and one will fail with serialization error
    3. PostgreSQL will ensure only one succeeds

**Result**: Only one person joins, race condition prevented ✅

## Status Validation Rules

✅ **Only users with `_AVAILABLE` statuses can be shown in face cards:**
- `AVAILABLE`
- `IN_SQUAD_AVAILABLE`
- `IN_BROADCAST_AVAILABLE`

✅ **Only users with `_AVAILABLE` statuses can become `MATCHED`:**
- Discovery service already filters by these statuses
- Only these statuses can transition to `MATCHED` → `IN_SQUAD`

✅ **Users with `IN_SQUAD` or `IN_BROADCAST` (without `_AVAILABLE`) are explicitly rejected:**
- Cannot create/join new rooms
- Cannot join via pull stranger
- Must leave current call first

## Database Changes

### Schema Update
- Added `pullStrangerEnabled Boolean @default(false)` to `CallSession` model
- Run migration: `npm run prisma:migrate` or `npm run prisma:push`

## API Endpoints

### 1. Enable Pull Stranger Mode (HOST only)
```
POST /streaming/rooms/:roomId/enable-pull-stranger
Body: { userId: "host-user-id" }
```

**Requirements:**
- User must be HOST
- Room must not be full (< 4 participants)
- Pull stranger mode must not already be enabled

**Actions:**
- Sets `pullStrangerEnabled = true`
- Updates all participants to `IN_SQUAD_AVAILABLE` status

### 2. Join Room Via Pull Stranger (One-way acceptance)
```
POST /streaming/rooms/:roomId/join-via-pull-stranger
Body: {
  joiningUserId: "user-c-id",
  targetUserId: "user-a-id"  // The user whose card was accepted
}
```

**Requirements:**
- Pull stranger mode must be enabled
- Target user must be in room with `IN_SQUAD_AVAILABLE` status
- Joining user must have `AVAILABLE` or `IN_SQUAD_AVAILABLE` status
- Room must not be full

**Actions:**
- Adds joining user to room
- Sets `pullStrangerEnabled = false`
- Updates all participants (including new joiner) to `IN_SQUAD` or `IN_BROADCAST` (preserves original status)

### 3. Get Room for Pull Stranger User (for discovery service)
```
GET /streaming/pull-stranger/room/:userId
```

**Returns:**
- `{ exists: true, roomId: "room-id" }` if user is in a room with pull stranger enabled
- `{ exists: false }` otherwise

## Discovery Service Integration

**Frontend Flow:**
1. C sees A's card in discovery (A has `IN_SQUAD_AVAILABLE` status)
2. C accepts A's card → Discovery service sets C to `MATCHED` status
3. Frontend calls: `GET /streaming/pull-stranger/room/:targetUserId` to get roomId
4. Frontend calls: `POST /streaming/rooms/:roomId/join-via-pull-stranger`
5. C joins room, all statuses restored

## Implementation Details

### Transaction Safety
- Uses PostgreSQL `Serializable` isolation level
- Prevents concurrent joins (race condition protection)
- Only one join succeeds per enable

### Status Preservation
- When joining via pull stranger, statuses are restored based on room's `isBroadcasting` flag:
  - If `isBroadcasting = true` → All participants get `IN_BROADCAST`
  - If `isBroadcasting = false` → All participants get `IN_SQUAD`

### Error Handling
- Clear error messages for all validation failures
- Explicit rejection of `IN_SQUAD`/`IN_BROADCAST` statuses
- Proper error messages for race conditions

## Testing Checklist

- [ ] HOST can enable pull stranger mode
- [ ] Non-HOST cannot enable pull stranger mode
- [ ] Cannot enable if room is full
- [ ] Cannot enable if already enabled
- [ ] Participants status changes to `IN_SQUAD_AVAILABLE`
- [ ] Discovery service shows users with `IN_SQUAD_AVAILABLE` status
- [ ] User can join via pull stranger
- [ ] Only one user can join per enable
- [ ] Race condition: Two users trying to join simultaneously - only one succeeds
- [ ] Statuses are restored correctly (preserves broadcasting state)
- [ ] Pull stranger mode disabled after join
- [ ] Can enable again after someone joins
- [ ] Users with `IN_SQUAD`/`IN_BROADCAST` cannot join
- [ ] Only `_AVAILABLE` statuses can be shown in face cards
