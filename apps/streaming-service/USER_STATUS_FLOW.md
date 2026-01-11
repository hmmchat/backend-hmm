# User Status Flow Documentation

This document describes all possible user statuses and how they transition from one status to another.

## User Statuses

### Core Statuses
- **`OFFLINE`** - User is not using the app (app closed/backgrounded). Only transition: OFFLINE → ONLINE (when user opens app)
- **`ONLINE`** - User is actively using the app (app is open and user is interacting)
- **`AVAILABLE`** - User is in the loading/matchmaking screen (Solo mode), available to be matched
- **`MATCHED`** - User has been matched (Solo mode) or is in squad lobby (Squad mode), ready to join a room
- **`IN_SQUAD`** - User is in an active squad/room (2-3 participants), call in progress
- **`IN_BROADCAST`** - User is broadcasting (participant in a live broadcast)
- **`WATCHING_HMM_TV`** - User is watching a live broadcast as a viewer

### Auxiliary Statuses (for discovery pool)
- **`IN_SQUAD_AVAILABLE`** - User is in a squad but available for matching (transitional)
- **`IN_BROADCAST_AVAILABLE`** - User is broadcasting but available for matching (transitional)

---

## Status Transition Tree

```
OFFLINE (Default/Initial State - User not using app)
└──→ ONLINE
    (User opens app - ONLY transition from OFFLINE)
    │
    ├──→ AVAILABLE (Solo Mode)
    │   │   (User enters loading/matchmaking screen - Solo mode)
    │   │
    │   ├──→ MATCHED (Solo Mode)
    │   │   │   (Discovery service matches users)
    │   │   │
    │   │   └──→ IN_SQUAD
    │   │       │   (Room created, users join call)
    │   │       │
    │   │       ├──→ IN_BROADCAST
    │   │       │   │   (Broadcast started)
    │   │       │   │
    │   │       │   └──→ ONLINE
    │   │       │       (Call ends or user leaves → back to ONLINE)
    │   │       │
    │   │       └──→ ONLINE
    │   │           (Call ends or user leaves → back to ONLINE)
    │   │
    │   └──→ ONLINE
    │       (User exits loading/matchmaking screen → back to ONLINE)
    │
    ├──→ MATCHED (Squad Mode)
    │   │   (User enters squad mode → MATCHED immediately)
    │   │   (User accepts squad invitation → MATCHED)
    │   │
    │   └──→ IN_SQUAD
    │       │   (Squad enters call - 2-3 members)
    │       │
    │       ├──→ IN_BROADCAST
    │       │   │   (Broadcast started)
    │       │   │
    │       │   └──→ ONLINE
    │       │       (Call ends or user leaves → back to ONLINE)
    │       │
    │       └──→ ONLINE
    │           (Call ends or user leaves → back to ONLINE)
    │
    ├──→ WATCHING_HMM_TV
    │   │   (User starts watching a broadcast)
    │   │
    │   └──→ ONLINE
    │       (User stops watching or stream ends → back to ONLINE)
    │
    └──→ OFFLINE
        (User closes app or goes to background)
```

---

## Detailed Status Transitions

### 1. OFFLINE → ONLINE
**Trigger**: User opens the app
- **Condition**: App is launched/foregrounded
- **Action**: User status becomes ONLINE (actively using app)
- **Can transition to**: `AVAILABLE` (Solo mode), `MATCHED` (Squad mode), `WATCHING_HMM_TV`, `OFFLINE` (app closed)

### 1a. ONLINE → AVAILABLE (Solo Mode)
**Trigger**: User enters the loading/matchmaking screen in Solo mode
- **Condition**: User is ONLINE and navigates to matchmaking (Solo toggle)
- **Action**: User becomes available for matching
- **Can transition to**: `MATCHED`, `ONLINE` (exit matchmaking), `WATCHING_HMM_TV`

### 1b. ONLINE → MATCHED (Squad Mode)
**Trigger**: User enters Squad mode or accepts squad invitation
- **Condition**: User is ONLINE and toggles to Squad mode OR accepts squad invitation
- **Action**: User enters squad lobby (MATCHED status)
- **Can transition to**: `IN_SQUAD` (enter call), `ONLINE` (toggle to Solo or leave squad)

### 2. AVAILABLE → MATCHED (Solo Mode)
**Trigger**: Discovery service matches users together
- **Condition**: Discovery service finds compatible users (2 users for Solo)
- **Action**: Users are notified of match
- **Can transition to**: `IN_SQUAD`, `AVAILABLE` (if match cancelled), `ONLINE` (exit matchmaking)

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

### 5. IN_SQUAD → ONLINE
**Trigger**: User leaves room or room ends
- **Condition**: 
  - User manually leaves (if others remain, room continues; if last one, room ends)
  - Room ends (all users leave - 0 participants remain)
- **Action**: User returns to ONLINE status (back to app home, not in matchmaking)
- **Note**: Room only ends when 0 participants remain. Single users can stay in existing rooms.
- **Next possible transition**: `ONLINE` → `AVAILABLE` (if user enters Solo matchmaking), `ONLINE` → `MATCHED` (if user enters Squad mode), `ONLINE` → `OFFLINE` (if user closes app)

### 6. IN_BROADCAST → ONLINE
**Trigger**: User leaves broadcast or broadcast ends
- **Condition**: 
  - User manually leaves (if others remain, room continues; if last one, room ends)
  - Broadcast ends (all participants leave - 0 participants remain)
- **Action**: User returns to ONLINE status (back to app home, not in matchmaking)
- **Note**: Room only ends when 0 participants remain. Single users can stay in existing rooms.
- **Next possible transition**: `ONLINE` → `AVAILABLE` (if user enters Solo matchmaking), `ONLINE` → `MATCHED` (if user enters Squad mode), `ONLINE` → `OFFLINE` (if user closes app)

### 7. ONLINE → OFFLINE
**Trigger**: User closes the app or app goes to background
- **Condition**: 
  - User closes the app
  - User backgrounds the app (OS-level)
- **Action**: User is no longer using the app
- **Note**: This is the only way to transition to OFFLINE. All other transitions use ONLINE as base state.

### 7a. AVAILABLE → ONLINE
**Trigger**: User exits the loading/matchmaking screen (Solo mode)
- **Condition**: 
  - User closes the matchmaking screen
  - User navigates away from matchmaking
- **Action**: User returns to ONLINE status (back to app home)
- **Note**: User is no longer in the matchmaking pool

### 8. ONLINE → WATCHING_HMM_TV
**Trigger**: User starts watching a live broadcast
- **Condition**: User is ONLINE and chooses to watch a broadcast
- **Action**: User becomes a viewer
- **Can transition to**: `ONLINE` (when leaving/stream ends), `OFFLINE` (if user closes app)

### 9. WATCHING_HMM_TV → ONLINE
**Trigger**: User stops watching or stream ends
- **Condition**: 
  - User manually stops watching
  - Broadcast stream ends (all participants leave)
- **Action**: User returns to ONLINE status (back to app home)
- **Note**: Viewers are NOT in the matchmaking pool
- **Next possible transition**: `ONLINE` → `AVAILABLE` (if user enters Solo matchmaking), `ONLINE` → `MATCHED` (if user enters Squad mode), `ONLINE` → `OFFLINE` (if user closes app)

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

### Scenario 1: Normal Call Flow (Solo Mode)
```
User1: OFFLINE → ONLINE → AVAILABLE → MATCHED → IN_SQUAD → ONLINE → OFFLINE
         (opens app)  (enters matchmaking)  (matched)  (in call)  (leaves call)  (closes app)
User2: OFFLINE → ONLINE → AVAILABLE → MATCHED → IN_SQUAD → ONLINE → OFFLINE
         (opens app)  (enters matchmaking)  (matched)  (in call)  (leaves call)  (closes app)
```

### Scenario 2: Broadcast Flow
```
Participant1: OFFLINE → ONLINE → AVAILABLE → MATCHED → IN_SQUAD → IN_BROADCAST → ONLINE
Participant2: OFFLINE → ONLINE → AVAILABLE → MATCHED → IN_SQUAD → IN_BROADCAST → ONLINE
Viewer1: OFFLINE → ONLINE → WATCHING_HMM_TV → ONLINE
```

### Scenario 3: Room Auto-End (2 participants)
```
User1 leaves: IN_SQUAD → (removed) → Room auto-ends → ONLINE
User2: IN_SQUAD → (auto-removed when room ends) → ONLINE
```

### Scenario 4: Room Auto-End (3 participants - Squad Call)
```
User1 leaves: IN_SQUAD → ONLINE (room continues, 2 remain)
User2 leaves: IN_SQUAD → (removed) → Room auto-ends → ONLINE
User3: IN_SQUAD → (auto-removed when room ends) → ONLINE
```

### Scenario 5: Viewer Watching Broadcast
```
Viewer: OFFLINE → ONLINE → WATCHING_HMM_TV → ONLINE (when stream ends or viewer leaves)
Participants: IN_BROADCAST → ONLINE (when broadcast ends)
```

### Scenario 6: Squad Mode Flow
```
Inviter: OFFLINE → ONLINE → MATCHED (enters squad mode) → IN_SQUAD → ONLINE
Invitee1: OFFLINE → ONLINE → MATCHED (accepts invitation) → IN_SQUAD → ONLINE
Invitee2: OFFLINE → ONLINE → MATCHED (accepts invitation) → IN_SQUAD → ONLINE
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
1. **Solo Matchmaking Path**: 
   - `OFFLINE` → `ONLINE` → `AVAILABLE` → `MATCHED` → `IN_SQUAD` → `IN_BROADCAST` (optional) → `ONLINE` → `OFFLINE`
   - When user leaves room: `IN_SQUAD` → `ONLINE` (back to app home)
   - When user exits matchmaking: `AVAILABLE` → `ONLINE` (back to app home)
   - When user closes app: `ONLINE` → `OFFLINE`
   
2. **Squad Mode Path**:
   - `OFFLINE` → `ONLINE` → `MATCHED` (enters squad mode) → `IN_SQUAD` → `ONLINE` → `OFFLINE`
   - When friend accepts invitation: `ONLINE` → `MATCHED` (joins squad lobby)
   - When squad enters call: `MATCHED` → `IN_SQUAD`
   - When squad leaves call: `IN_SQUAD` → `ONLINE`
   - When user toggles Solo: `MATCHED` → `AVAILABLE` (if enters matchmaking) or `ONLINE` (if exits)
   
3. **Viewing Path**: 
   - `OFFLINE` → `ONLINE` → `WATCHING_HMM_TV` → `ONLINE` → `OFFLINE`
   
4. **Direct Viewing from Matchmaking**: 
   - `ONLINE` → `AVAILABLE` → `WATCHING_HMM_TV` → `ONLINE` → `OFFLINE`

**Key Rules**:
- **ONLINE/OFFLINE Concept**: Only transition is `OFFLINE → ONLINE` (when user opens app). All other transitions use `ONLINE` as base state.
- Room cannot exist with only 1 person (auto-ends)
- Viewers go to `ONLINE` when stream ends (back to app home)
- Participants go to `ONLINE` when room ends (back to app home, not to matchmaking pool)
- Users go to `ONLINE` when they exit matchmaking/leave rooms (back to app home)
- Users go to `OFFLINE` only when they close the app or app goes to background
- Squad mode: User enters squad → `MATCHED` immediately (squad lobby)
- Squad mode: Invitations expire if inviter status changes (OFFLINE, IN_SQUAD, AVAILABLE) or after 10 minutes
- Squad mode: Maximum 3 members (1 inviter + 2 invitees)

