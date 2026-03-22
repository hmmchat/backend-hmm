# User status (`UserStatus`) — frontend guide

This document explains how **`UserStatus`** works in backend-hmm, **which transitions the backend performs** (no client `PATCH` required), **where the app may call `PATCH /me/status`**, and **which HTTP/WebSocket APIs** to use so status stays correct.

Paths below are **service controller paths**. Your **API gateway** may add a prefix (for example `/v1` or service-specific prefixes)—align with your deployed route map.

---

## 1. Canonical `UserStatus` enum (user-service)

Stored on the user profile and returned on **`GET /me`** (field `status`). Valid values:

| Value | Typical meaning |
|-------|-----------------|
| `AVAILABLE` | In the solo discovery pool (among other “available” states). |
| `ONLINE` | App / presence signal (also used in squad/offline flows). |
| `OFFLINE` | Not available for certain flows; used in offline-card pools. |
| `MATCHED` | Paired with another user for the match flow. |
| `IN_SQUAD` | In an active call/session as a participant (squad context). |
| `IN_SQUAD_AVAILABLE` | In/around squad while still eligible for secondary matching (product-specific). |
| `IN_BROADCAST` | Broadcasting or in broadcast-related session state. |
| `IN_BROADCAST_AVAILABLE` | Available for matching while tied to broadcast context (product-specific). |
| `VIEWER` | Viewing / waitlist-style participation. |

**Source of truth in repo:** `apps/user-service/src/dtos/profile.dto.ts` (`UserStatusEnum`), Prisma `UserStatus` in `apps/user-service/prisma/schema.prisma`.

**Do not confuse with** auth **account** state (`ACTIVE`, `BANNED`, etc.)—that is a different concept in auth-service.

---

## 2. Backend-owned transitions (frontend does **not** drive these with `PATCH`)

Treat these as **side effects** of calling the right **discovery**, **squad**, and **streaming** APIs (and WebSocket actions). After each step, **refresh profile** (`GET /me`) or your existing polling/realtime.

| Transition / state | Handled by |
|--------------------|------------|
| → `MATCHED` | Discovery matching when a match is created; squad invite/accept paths that pair users. |
| → `IN_SQUAD` | `POST /discovery/proceed` when **both** users accept (creates streaming room + updates status); **`POST /streaming/rooms`** when users are `MATCHED`; squad **`POST /squad/lobby/enter-call`** (room creation). |
| → `IN_BROADCAST` / `IN_SQUAD` / `*_AVAILABLE` / `VIEWER` | Streaming **room** and **WebSocket** flows (`RoomService` updates user-service via internal paths). |
| → `AVAILABLE` | Raincheck / timeouts / call end / cleanup paths in discovery and streaming (e.g. internal **`call-ended`** notification chain). |

**Client rule:** Do **not** call `PATCH /me/status` to “simulate” `MATCHED`, room lifecycle, broadcast, or viewer states. Call the **business APIs** below and reflect **`GET /me`**.

---

## 3. Where the frontend **may** call `PATCH /me/status` (manual / coarse)

`PATCH /me/status` (user-service) accepts any **single** enum value from the list above; the handler **does not enforce a transition graph**—only Zod enum validation.

Use **`PATCH /me/status` sparingly** for **presence / pool / product toggles**, for example:

| Situation | Typical body | Notes |
|-----------|----------------|--------|
| User should enter or re-enter the **solo discovery pool** | `{ "status": "AVAILABLE" }` | Pool logic also includes `IN_SQUAD_AVAILABLE` / `IN_BROADCAST_AVAILABLE` in matching—follow product spec. |
| Product maps **foreground/background** or offline cards to presence | `{ "status": "ONLINE" }` or `{ "status": "OFFLINE" }` | Only if your UX spec ties these enums to client-reported presence. |
| After **`POST /squad/toggle-solo`** | `{ "status": "AVAILABLE" }` (typical) | Squad controller notes that returning to solo may require the client (or discovery) to set status so solo matchmaking works. |

**Anti-patterns:** Using `PATCH` as the primary way to advance match → room → broadcast. That belongs to **discovery + streaming** flows.

---

## 4. Always: read status after flows

| API | Purpose |
|-----|---------|
| **`GET /me`** (user-service; optional `?fields=status,...`) | Canonical **`status`** for UI after discovery, squad, or streaming actions. |

---

## 5. APIs the frontend should use (by service)

### 5.1 User-service

| Method & path | When |
|---------------|------|
| **`GET /me`** | Load or refresh `status` (and profile). |
| **`PATCH /me/status`** | Only for the **manual** cases in §3. |

*(Gateway may expose these under `/v1/...`—match your deployment.)*

### 5.2 Discovery-service (`/discovery/...`)

| Method & path | When | Status notes |
|---------------|------|----------------|
| **`GET /discovery/card`** | Swiping / next card | May create a match → users often become **`MATCHED`**. |
| **`POST /discovery/proceed`** | Accept match (`matchedUserId` in body) | Records acceptance; when **both** accept → creates streaming room, sets **`IN_SQUAD`**, may return `roomId` / `sessionId`. |
| **`POST /discovery/raincheck`** | Pass on a card | Raincheck handling; can reset affected users toward **`AVAILABLE`**. |
| **`POST /discovery/reset-session`** | Reset raincheck session for a city | Session cleanup. |
| **`POST /discovery/select-location`** | User picks a city from location UI | Location flow. |
| **`GET /discovery/offline-cards/card`** | Offline stack | Pool uses **`ONLINE` / `OFFLINE` / `VIEWER`**-style filtering per discovery logic. |
| **`POST /discovery/offline-cards/raincheck`** | Pass on offline card | Offline raincheck behavior. |

**Do **not** call from the app (service-to-service only):**

- `POST /discovery/internal/room-created`
- `POST /discovery/internal/broadcast-started`
- `POST /discovery/internal/call-ended`

These are invoked by **streaming-service**, not the mobile/web client.

### 5.3 Squad (`/squad/...`)

| Method & path | When |
|---------------|------|
| **`POST /squad/invite`**, **`POST /squad/invite-external`** | Start squad invite |
| **`POST /squad/invitations/:inviteId/accept`**, **`reject`** | Invitee responds |
| **`GET /squad/lobby`** | Show lobby |
| **`POST /squad/lobby/enter-call`** | 2+ members → creates room via streaming (`roomId`, `sessionId`) |
| **`POST /squad/toggle-solo`** | Leave squad for solo → often pair with **`PATCH /me/status`** → `AVAILABLE` (see §3) |

### 5.4 Streaming HTTP (`/streaming/...`)

| Method & path | When |
|---------------|------|
| **`POST /streaming/rooms`** | Body: `{ "userIds": [...], "callType": "matched" \| "squad" }`. Matched calls require participants **`MATCHED`**. Creates session; updates status toward **`IN_SQUAD`**. Use if room was not already created by **`POST /discovery/proceed`**, or for squad flows as implemented. |
| **`GET /streaming/rooms/:roomId`**, **`GET /streaming/users/:userId/room`** | Reconcile “in a room?” vs **`GET /me`**. |
| **`POST /streaming/rooms/:roomId/...`** | Pull-stranger, waitlist, **`accept-from-waitlist`**, etc.—drive **`MATCHED` / `VIEWER` / `IN_*_AVAILABLE`** per `RoomService` rules. |

### 5.5 Streaming WebSocket (`/streaming/ws`)

Use for **in-call** behavior: **`join-room`**, **`leave-room`**, **`start-broadcast`**, **`stop-broadcast`**, **`join-as-viewer`**, etc. These update user-service status through streaming (not via client `PATCH` for each step).

---

## 6. Short integration checklist

1. **Discovery:** `GET /discovery/card` → **`POST /discovery/proceed`** as needed → **`POST /discovery/raincheck`** when passing.
2. **Room:** **`POST /discovery/proceed`** (may create room) and/or **`POST /streaming/rooms`** + **WebSocket** for media and broadcast.
3. **Squad:** squad endpoints → **`POST /squad/lobby/enter-call`** → **`PATCH /me/status`** only where product requires (e.g. after **toggle-solo**).
4. **Refresh** **`GET /me`** after each important step.

---

## 7. Related code references

| File | What |
|------|------|
| `apps/user-service/src/dtos/profile.dto.ts` | `UserStatusEnum`, `UpdateStatusSchema` |
| `apps/user-service/src/routes/user.controller.ts` | `PATCH me/status` |
| `apps/user-service/src/services/user.service.ts` | `updateStatus` |
| `apps/user-service/prisma/schema.prisma` | `enum UserStatus` |
| `apps/discovery-service/...` | Matching, raincheck, proceed, internal hooks |
| `apps/streaming-service/...` | Rooms, WebSocket gateway, `RoomService` status updates |

---

## 8. Doc maintenance

**Profile `status`** (`GET /me`) must match **`UserStatusEnum`** in user-service. **`FRONTEND_INTEGRATION.md`** is kept aligned with this file. **`history`** participant `userStatus` (`SQUAD` / `BROADCAST` / `DROP_IN`) is a **separate** history-API label—do not mix it with `UserStatus`.
