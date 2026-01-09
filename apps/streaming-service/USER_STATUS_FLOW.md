# User Status Flow Documentation

This document describes all possible user statuses and how they transition from one status to another.

## User Statuses

### Core Statuses
- **`OFFLINE`** - Default status. User is not actively using the app or is not in matchmaking
- **`AVAILABLE`** - User is in the loading/matchmaking screen, available to be matched
- **`MATCHED`** - User has been matched with other users, ready to join a room
- **`IN_SQUAD`** - User is in an active squad/room (2-4 participants), call in progress
- **`IN_BROADCAST`** - User is broadcasting (participant in a live broadcast)
- **`WATCHING_HMM_TV`** - User is watching a live broadcast as a viewer

### Auxiliary Statuses (for discovery pool)
- **`IN_SQUAD_AVAILABLE`** - User is in a squad but available for matching (transitional)
- **`IN_BROADCAST_AVAILABLE`** - User is broadcasting but available for matching (transitional)

---

## Status Transition Tree

```
OFFLINE (Default/Initial State)
├──→ AVAILABLE
│   │   (User enters loading/matchmaking screen)
│   │
│   ├──→ MATCHED
│   │   │   (Discovery service matches users)
│   │   │
│   │   ├──→ IN_SQUAD
│   │   │   │   (Room created, users join call)
│   │   │   │
│   │   │   ├──→ IN_BROADCAST
│   │   │   │   │   (Broadcast started)
│   │   │   │   │
│   │   │   │   └──→ AVAILABLE
│   │   │   │       (Call ends or user leaves → back to matchmaking pool)
│   │   │   │       └──→ OFFLINE
│   │   │   │           (User exits loading/matchmaking screen)
│   │   │   │
│   │   │   └──→ AVAILABLE
│   │   │       (Call ends or user leaves → back to matchmaking pool)
│   │   │       └──→ OFFLINE
│   │   │           (User exits loading/matchmaking screen)
│   │   │
│   │   └──→ AVAILABLE
│   │       (Matching cancelled, back to pool)
│   │       └──→ OFFLINE
│   │           (User exits loading/matchmaking screen)
│   │
│   └──→ WATCHING_HMM_TV
│       (User starts watching a broadcast from matchmaking screen)
│       │
│       └──→ OFFLINE
│           (User stops watching or stream ends)
│
└──→ WATCHING_HMM_TV
    (User directly watches broadcast without being in matchmaking)
    │
    └──→ OFFLINE
        (User stops watching or stream ends)
```

---

## Detailed Status Transitions

### 1. OFFLINE → AVAILABLE
**Trigger**: User enters the loading/matchmaking screen
- **Condition**: User opens app and navigates to matchmaking
- **Action**: User becomes available for matching
- **Can transition to**: `MATCHED`, `WATCHING_HMM_TV`

### 2. AVAILABLE → MATCHED
**Trigger**: Discovery service matches users together
- **Condition**: Discovery service finds compatible users (2-4 users)
- **Action**: Users are notified of match
- **Can transition to**: `IN_SQUAD`, `AVAILABLE` (if match cancelled)

### 3. MATCHED → IN_SQUAD
**Trigger**: Users create/join a room (call starts)
- **Condition**: 
  - Users must have `MATCHED` status
  - Minimum 2 users, maximum 4 users
  - All users ready to start call
- **Action**: Room created, users enter call
- **Can transition to**: `IN_BROADCAST`, `AVAILABLE` (when leaving/room ends)

### 4. IN_SQUAD → IN_BROADCAST
**Trigger**: Broadcast starts in the room
- **Condition**: Room is active, participants choose to broadcast
- **Action**: Participants become broadcasters
- **Can transition to**: `AVAILABLE` (when leaving/room ends)

### 5. IN_SQUAD → AVAILABLE
**Trigger**: User leaves room or room ends
- **Condition**: 
  - User manually leaves (if others remain, room continues; if last one, room ends)
  - Room ends (all users leave - 0 participants remain)
- **Action**: User returns to discovery/matchmaking pool (still in loading/matchmaking screen)
- **Note**: Room only ends when 0 participants remain. Single users can stay in existing rooms.
- **Next possible transition**: `AVAILABLE` → `OFFLINE` (when user exits matchmaking screen)

### 6. IN_BROADCAST → AVAILABLE
**Trigger**: User leaves broadcast or broadcast ends
- **Condition**: 
  - User manually leaves (if others remain, room continues; if last one, room ends)
  - Broadcast ends (all participants leave - 0 participants remain)
- **Action**: User returns to discovery/matchmaking pool (still in loading/matchmaking screen)
- **Note**: Room only ends when 0 participants remain. Single users can stay in existing rooms.
- **Next possible transition**: `AVAILABLE` → `OFFLINE` (when user exits matchmaking screen)

### 10. AVAILABLE → OFFLINE
**Trigger**: User exits the loading/matchmaking screen
- **Condition**: 
  - User closes the matchmaking screen
  - User navigates away from matchmaking
  - User closes the app
- **Action**: User is no longer in the matchmaking pool
- **Note**: This happens after user leaves a room (`IN_SQUAD` → `AVAILABLE` → `OFFLINE`)

### 7. AVAILABLE → WATCHING_HMM_TV
**Trigger**: User starts watching a live broadcast
- **Condition**: User is available and chooses to watch a broadcast
- **Action**: User becomes a viewer
- **Can transition to**: `OFFLINE` (when leaving/stream ends)

### 8. OFFLINE → WATCHING_HMM_TV
**Trigger**: User directly watches broadcast (without being in matchmaking)
- **Condition**: User is offline and opens app to watch broadcast
- **Action**: User becomes a viewer
- **Can transition to**: `OFFLINE` (when leaving/stream ends)

### 9. WATCHING_HMM_TV → OFFLINE
**Trigger**: User stops watching or stream ends
- **Condition**: 
  - User manually stops watching
  - Broadcast stream ends (all participants leave)
- **Action**: User goes offline (not in matchmaking)
- **Note**: Viewers are NOT in the matchmaking pool

---

## Room Lifecycle Rules

### Room Creation Rules
1. **Minimum 2 users, maximum 4 users** required to create a room
2. **Only users with `MATCHED` status** can create/join rooms (enforced in production)
3. **Users cannot be in multiple active rooms** simultaneously

### Room End Rules
1. **Single users CAN stay in rooms once created**
   - If a user leaves and only 1 participant remains, that person CAN stay in the room
   - Room continues with single user (does NOT auto-end)
2. **All participants' statuses update** when room ends:
   - Participants (`IN_SQUAD`/`IN_BROADCAST`) → `AVAILABLE`
   - Viewers (`WATCHING_HMM_TV`) → `OFFLINE`
3. **Room ends when**:
   - 0 participants remain (all participants leave)
   - Broadcast ends (if applicable)
4. **Room creation requires 2+ users** - Single users cannot create rooms, but can stay once room exists

### Viewer Rules
1. **Viewers can only watch when broadcast is active** (`IN_BROADCAST` status)
2. **Viewers are not participants** - they don't count toward room participant limits
3. **When viewers leave or stream ends**: Status → `OFFLINE` (not `AVAILABLE`)
4. **Viewers cannot create rooms** - they must be in `AVAILABLE` or `MATCHED` status first

---

## Status Update Scenarios

### Scenario 1: Normal Call Flow (with matchmaking screen exit)
```
User1: OFFLINE → AVAILABLE → MATCHED → IN_SQUAD → AVAILABLE → OFFLINE
         (enters matchmaking)  (matched)  (in call)  (leaves call)  (exits matchmaking)
User2: OFFLINE → AVAILABLE → MATCHED → IN_SQUAD → AVAILABLE → OFFLINE
         (enters matchmaking)  (matched)  (in call)  (leaves call)  (exits matchmaking)
```

### Scenario 2: Broadcast Flow
```
Participant1: OFFLINE → AVAILABLE → MATCHED → IN_SQUAD → IN_BROADCAST → AVAILABLE
Participant2: OFFLINE → AVAILABLE → MATCHED → IN_SQUAD → IN_BROADCAST → AVAILABLE
Viewer1: OFFLINE → WATCHING_HMM_TV → OFFLINE
```

### Scenario 3: Room Auto-End (2 participants)
```
User1 leaves: IN_SQUAD → (removed) → Room auto-ends → AVAILABLE
User2: IN_SQUAD → (auto-removed when room ends) → AVAILABLE
```

### Scenario 4: Room Auto-End (3 participants)
```
User1 leaves: IN_SQUAD → AVAILABLE (room continues, 2 remain)
User2 leaves: IN_SQUAD → (removed) → Room auto-ends → AVAILABLE
User3: IN_SQUAD → (auto-removed when room ends) → AVAILABLE
```

### Scenario 5: Viewer Watching Broadcast
```
Viewer: OFFLINE → WATCHING_HMM_TV → OFFLINE (when stream ends or viewer leaves)
Participants: IN_BROADCAST → AVAILABLE (when broadcast ends)
```

---

## Status Validation Rules

### Room Creation Validation
- ✅ Users must have `MATCHED` status (production mode)
- ✅ Users cannot be in active rooms already
- ✅ Minimum 2, maximum 4 users

### Status Update Validation
- ✅ Only valid transitions are allowed
- ✅ Status updates are idempotent (can be called multiple times safely)
- ✅ Status updates fail gracefully if user-service is unavailable (in TEST_MODE)

---

## Implementation Notes

### TEST_MODE Behavior
- **Status validation is SKIPPED** in TEST_MODE
- Allows testing without user-service running
- Users can create rooms regardless of status
- All other business rules still apply

### Production Behavior
- **ALL validations are enforced**
- Status checks fail if user-service is unavailable
- Users must follow proper status flow
- Room creation requires `MATCHED` status

---

## API Endpoints for Status Updates

### Streaming Service → User Service
- **Update User Status**: `PATCH /users/test/:userId/status` (body: `{ status: "..." }`)
- **Get User Status**: `GET /users/test/:userId?fields=status`

### Status Updates Handled by Streaming Service
- `MATCHED` → `IN_SQUAD` (when room created)
- `IN_SQUAD` → `IN_BROADCAST` (when broadcast starts)
- `IN_SQUAD`/`IN_BROADCAST` → `AVAILABLE` (when participant leaves/room ends)
- `WATCHING_HMM_TV` → `OFFLINE` (when viewer leaves/stream ends)

---

## Summary

**Default State**: `OFFLINE`

**Main Paths**:
1. **Matchmaking Path**: 
   - `OFFLINE` → `AVAILABLE` → `MATCHED` → `IN_SQUAD` → `IN_BROADCAST` (optional) → `AVAILABLE` → `OFFLINE`
   - When user leaves room: `IN_SQUAD` → `AVAILABLE` (back to matchmaking pool)
   - When user exits matchmaking: `AVAILABLE` → `OFFLINE`
   
2. **Viewing Path**: 
   - `OFFLINE` → `WATCHING_HMM_TV` → `OFFLINE`
   
3. **Direct Viewing from Matchmaking**: 
   - `AVAILABLE` → `WATCHING_HMM_TV` → `OFFLINE`

**Key Rules**:
- Room cannot exist with only 1 person (auto-ends)
- Viewers go to `OFFLINE` when stream ends (not `AVAILABLE`)
- Participants go to `AVAILABLE` when room ends (back to matchmaking pool)
- Users go to `OFFLINE` when they exit the matchmaking/loading screen
- `OFFLINE` is the default and exit state for both viewers and users who exit matchmaking

