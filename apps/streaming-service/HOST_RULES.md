# Host Rules and Edge Cases

## Core Rules

### 1. Host Assignment
- **Hosts can be 2, 3, or 4** - Cannot be 1 (call cannot be initiated by 1 person)
- **People who initiate calls are HOSTS**
  - **Matched call**: First 2 users = both HOSTS
  - **Squad call**: All 2-4 users = all HOSTS
- **People who join later are PARTICIPANTs** (always)

### 2. Leave Call
- **Everyone can leave** (HOSTS and PARTICIPANTs)
- When user leaves, status → `AVAILABLE` (back to discovery pool)

### 3. Kick User
- **HOSTS can kick any PARTICIPANT**
- **HOSTS cannot kick each other**
- **PARTICIPANTs cannot kick anybody**

### 4. Broadcasting
- **Only HOSTS can turn on broadcasting**
- **Only HOSTS can turn off broadcasting** (returns to IN_SQUAD)

## Edge Cases Handled

### ✅ Edge Case 1: All Hosts Leave
**Scenario**: All HOSTS leave, but PARTICIPANTs remain
**Current Behavior**: Room continues with PARTICIPANTs until participant count drops to 1
**Status**: ✅ Handled - Room continues until 1 participant remains

### ✅ Edge Case 2: Last Host Leaves (Other Participants Remain)
**Scenario**: Last HOST leaves, but PARTICIPANTs remain
**Current Behavior**: Room continues with remaining PARTICIPANTs until count drops to 1
**Note**: Room can exist without any HOSTS (only PARTICIPANTs remain)
**Status**: ✅ Handled - Room continues until 1 participant remains (Option B)

### ✅ Edge Case 3: Participant Kicked (Only 1 Remains)
**Scenario**: HOST kicks PARTICIPANT, only 1 person remains (irrespective of host/participant)
**Current Behavior**: Room continues - single user can stay in the room
**Status**: ✅ Handled - Single users can stay once room exists

### ✅ Edge Case 4: Host Tries to Kick Themselves
**Scenario**: HOST tries to kick themselves
**Current Behavior**: Prevented in `canKickUser()` - returns false if kicker === target
**Status**: ✅ Handled

### ✅ Edge Case 5: Participant Tries to Start Broadcast
**Scenario**: PARTICIPANT tries to start broadcasting
**Current Behavior**: Throws error - "Only HOSTs can enable broadcasting"
**Status**: ✅ Handled

### ✅ Edge Case 6: Participant Tries to Stop Broadcast
**Scenario**: PARTICIPANT tries to stop broadcasting
**Current Behavior**: Throws error - "Only HOSTs can disable broadcasting"
**Status**: ✅ Handled

### ✅ Edge Case 7: All Hosts Leave, Participants Try to Broadcast
**Scenario**: All HOSTS leave, PARTICIPANTs remain and try to broadcast
**Current Behavior**: Will fail - Only HOSTS can broadcast
**Status**: ✅ Handled (participants cannot broadcast)

## Potential Edge Cases to Consider

### ✅ Edge Case A: Room with No Hosts
**Scenario**: After all HOSTS leave, room continues with only PARTICIPANTs
**Current**: Room continues even with 1 participant (single user can stay)
**Status**: ✅ Handled - Room continues with PARTICIPANTs, single user can stay

### ✅ Edge Case B: Room Ends While Broadcasting
**Scenario**: Room ends (0 persons remain) while broadcast is active
**Current**: Broadcasting automatically stops, all viewers removed and status → OFFLINE
**Status**: ✅ Handled - `endRoom()` sets `isBroadcasting: false` and removes all viewers
**Note**: Room only ends when 0 participants remain, not when 1 remains

### ⚠️ Edge Case C: Last Host Kicks Last Participant
**Scenario**: Only 1 HOST and 1 PARTICIPANT remain, HOST kicks PARTICIPANT
**Current**: PARTICIPANT is removed, room continues with single HOST (can stay in room)
**Status**: ✅ Handled correctly - Single user can stay after others leave

### ⚠️ Edge Case D: Broadcast Stop - Viewers Present
**Scenario**: HOST stops broadcast while viewers are watching
**Current**: Viewers are automatically removed and status → OFFLINE
**Status**: ✅ Handled in `disableBroadcasting()`

## Implementation Status

| Feature | Status | Notes |
|---------|--------|-------|
| Multiple HOSTS (2-4) | ✅ | Matched: 2 hosts, Squad: all hosts |
| HOST can kick PARTICIPANT | ✅ | Validated in `canKickUser()` |
| HOST cannot kick HOST | ✅ | Prevented in `canKickUser()` |
| PARTICIPANT cannot kick | ✅ | Prevented in `canKickUser()` |
| HOST only: Start broadcast | ✅ | Validated in `enableBroadcasting()` |
| HOST only: Stop broadcast | ✅ | Validated in `disableBroadcasting()` |
| Everyone can leave | ✅ | `removeParticipant()` available to all |
| Room auto-ends (0 persons) | ✅ | Handled in `removeParticipant()` - only ends when 0 remain |
| Kick self prevention | ✅ | Checked in `canKickUser()` |
| Broadcast stop removes viewers | ✅ | Handled in `disableBroadcasting()` |

## Room Ending Rules (Confirmed)

### Rule: Room ends when 0 persons remain
- **Room ends when participant count drops to 0** (irrespective of HOST or PARTICIPANT)
- **Single users CAN stay in rooms** once the room exists (even if created with 2+ users)
- **Example Flow**:
  1. a, b start call (HOSTS) → Room: a(HOST), b(HOST)
  2. c, d join (PARTICIPANTs) → Room: a(HOST), b(HOST), c(PARTICIPANT), d(PARTICIPANT)
  3. a leaves → Room: b(HOST), c(PARTICIPANT), d(PARTICIPANT) ✅ Continues
  4. b leaves → Room: c(PARTICIPANT), d(PARTICIPANT) ✅ Continues (no HOSTS)
  5. c leaves → Room: d(PARTICIPANT) ✅ **Continues** (single user can stay)
  6. d leaves → Room: (empty) → **Room ends** (0 persons)

### Rule: Broadcasting stops when room ends
- **If broadcasting is active when room ends**, broadcasting automatically stops
- **All viewers are removed** and their status → OFFLINE

## Additional Edge Cases to Test
- [ ] Room with 2 HOSTS, 1 kicks the other → Should fail (HOST cannot kick HOST)
- [ ] Room with 2 HOSTS, 1 HOST leaves → Room continues with 1 HOST + PARTICIPANTs
- [ ] Room with 3 HOSTS, all leave → Room ends
- [ ] Broadcast active, last HOST leaves → Should auto-stop broadcast
- [ ] PARTICIPANT tries to kick → Should fail
- [ ] PARTICIPANT tries to start/stop broadcast → Should fail

## Summary

✅ **All core rules are implemented correctly**
✅ **Room ending behavior confirmed**: Room ends only when 0 persons remain
✅ **Single user support**: Once a room exists, single users can stay (room doesn't auto-end)
✅ **Broadcasting auto-stops**: When room ends, broadcasting stops and viewers are removed

### Confirmed Behavior:
- Room continues even if all HOSTS leave (as long as 1+ participant)
- **Single users CAN stay in rooms** once the room exists (created with 2+ users)
- Room ends only when 0 participants remain (irrespective of HOST/PARTICIPANT)
- Broadcasting automatically stops when room ends
- All viewers removed when room ends (status → OFFLINE)

