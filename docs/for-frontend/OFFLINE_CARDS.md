# Discovery: OFFLINE Cards integration guide

This document describes how the frontend should integrate the OFFLINE Cards experience, including behavior, APIs, and edge cases from current backend implementation.

All paths assume API Gateway prefix `/v1`.

- Base URL: `API_BASE` (example: `https://api.example.com`)
- Auth: send `Authorization: Bearer <access_token>` on authenticated routes

---

## 1) What OFFLINE Cards are (current behavior)

OFFLINE Cards are a browse-only discovery stack:

- Candidate pool statuses are: `ONLINE`, `OFFLINE`, `VIEWER`
- Uses the same card shape/scoring UI primitives as discovery face cards
- Does **not** create or advance matches
- Does **not** call `proceed` flow
- Supports session-level raincheck exclusions, isolated from normal discovery

Important implementation detail:

- OFFLINE Cards internally use `offline-${sessionId}` in backend raincheck/session lookups.
- This isolates OFFLINE pass history from regular `GET /discovery/card` sessions.

---

## 2) Core frontend flow

1. Enter OFFLINE stack with a stable `sessionId`  
   `GET /v1/discovery/offline-cards/card?sessionId=...`

2. Render user card  
   Card is a user card (not a `LOCATION` promo type).

3. Skip/pass current card  
   `POST /v1/discovery/offline-cards/raincheck` with `{ sessionId, raincheckedUserId }`

4. Connect action from card  
   Send friend request using friend-service route:
   `POST /v1/friends/me/friends/offline-cards/request` with `{ toUserId }`

5. Optional: gift from card (no room context)  
   `POST /v1/streaming/offline-cards/gifts` with `{ toUserId, amount, giftId }`

6. Optional: report from card  
   `POST /v1/users/report` with `{ reportedUserId, reportType: "offline_card" }`

---

## 3) API reference

### 3.1 Discovery-service (OFFLINE stack)

#### `GET /v1/discovery/offline-cards/card`

Query:

- `sessionId` (required, string)
- `soloOnly` (optional, boolean-like string)

Response shape:

```json
{
  "card": {
    "userId": "uuid",
    "username": "string",
    "age": 25,
    "dateOfBirth": "1999-01-01T00:00:00.000Z",
    "displayPictureUrl": "https://...",
    "city": "Mumbai",
    "country": "",
    "intent": "Here to meet new people",
    "brands": [{ "name": "Nike", "logoUrl": "https://..." }],
    "interests": [{ "name": "Travel" }],
    "values": [{ "name": "Honesty" }],
    "musicPreference": { "name": "Song", "artist": "Artist" },
    "pages": [{ "photoUrl": "https://...", "order": 0 }],
    "status": "ONLINE",
    "reportCount": 0,
    "reportLayer": 0,
    "reportLayerThresholds": { "layer1": 1, "layer2": 3, "layer3": 5, "ban": 7 },
    "reported": false,
    "matchExplanation": {
      "reasons": ["Shared 2 interests: Travel, Music"],
      "score": 78,
      "commonBrands": ["Nike"],
      "commonInterests": ["Travel", "Music"],
      "commonValues": ["Honesty"],
      "sameMusic": false,
      "sameCity": true,
      "sameVideoPreference": true
    }
  },
  "exhausted": false
}
```

Exhausted response:

```json
{
  "card": null,
  "exhausted": true
}
```

Notes:

- `status` on card should be one of `ONLINE | OFFLINE | VIEWER` in OFFLINE stack.
- `soloOnly` is accepted in the request but currently not applied in OFFLINE candidate filtering (backend ignores it in matching function).

#### `POST /v1/discovery/offline-cards/raincheck`

Body:

```json
{
  "sessionId": "offline-session-123",
  "raincheckedUserId": "target-user-id"
}
```

Response:

```json
{
  "success": true,
  "nextCard": {
    "userId": "next-user-id"
  }
}
```

Notes:

- Raincheck is recorded bidirectionally for this OFFLINE session:
  - viewer excludes target
  - target excludes viewer
- Response includes `nextCard` directly; frontend may render it immediately.
- Backend currently fetches next card with `soloOnly=false` in this endpoint.

### 3.2 Friend-service (connect action)

#### `POST /v1/friends/me/friends/offline-cards/request`

Body:

```json
{
  "toUserId": "target-user-id"
}
```

Response:

```json
{
  "ok": true,
  "requestId": "friend-request-id",
  "autoAccepted": false
}
```

Notes:

- This is the public friend-request route for OFFLINE card UI.
- Use `requestId` for subsequent message flows if needed.

### 3.3 Streaming-service (optional gifting from OFFLINE cards)

#### `POST /v1/streaming/offline-cards/gifts`

Body:

```json
{
  "toUserId": "target-user-id",
  "amount": 100,
  "giftId": "gift_monkey"
}
```

Response:

```json
{
  "success": true
}
```

Notes:

- No room context required.
- Uses direct gift transfer flow.
- Amount is treated as gift transfer value in backend gift pipeline.

### 3.4 User-service report API (recommended moderation action)

#### `POST /v1/users/report`

Body:

```json
{
  "reportedUserId": "target-user-id",
  "reportType": "offline_card"
}
```

Response:

```json
{
  "success": true,
  "reportCount": 12
}
```

---

## 4) Frontend state handling recommendations

- Keep a dedicated OFFLINE stack state (`offlineSessionId`, current card, exhausted flag).
- On pass, optimistically disable actions for current card until raincheck returns `nextCard`.
- Treat `exhausted=true` as terminal for that session; provide refresh CTA with a new `sessionId`.
- Do not call `POST /v1/discovery/proceed` from OFFLINE card UI.
- Do not expect LOCATION promo cards in OFFLINE stack responses.

---

## 5) Differences from regular discovery

- Endpoint family is `/discovery/offline-cards/*` (not `/discovery/card` + `/discovery/proceed`)
- Candidate statuses are `ONLINE/OFFLINE/VIEWER` (not discovery availability statuses)
- No match creation side effects
- Session rainchecks are namespaced with `offline-` prefix

---

## 6) Recent backend changes that affect integration

These are the key recent changes relevant for frontend OFFLINE integration:

1. **Session pool override framework added in discovery**  
   Discovery service now uses effective session-based pool city logic (`sessionDiscoveryCityOverride`).  
   OFFLINE stack also reads via this mechanism, but with its own prefixed session namespace.

2. **Report-layer fields on cards are now part of response model**  
   Card payload includes `reportCount`, `reportLayer`, and `reportLayerThresholds` from backend scoring/report-layer configuration.

3. **OFFLINE gift route is live but under-documented in frontend docs**  
   `POST /v1/streaming/offline-cards/gifts` exists and is suitable for OFFLINE card gift CTA.

4. **Existing docs partially mention OFFLINE APIs but not full behavior**  
   `FRONTEND_INTEGRATION.md` and `USER_STATUS_AND_APIS.md` mention routes, but not key behavior details like:
   - no match creation
   - bidirectional raincheck
   - session prefix isolation
   - current `soloOnly` caveat

---

## 7) Source references (backend repo)

- Discovery controller: `apps/discovery-service/src/routes/discovery.controller.ts`
- Discovery DTOs: `apps/discovery-service/src/dtos/discovery.dto.ts`
- OFFLINE behavior and card shape: `apps/discovery-service/src/services/discovery.service.ts`
- Friend request from OFFLINE card: `apps/friend-service/src/routes/friend.controller.ts`
- Gift from OFFLINE card: `apps/streaming-service/src/controllers/streaming.controller.ts`
- Report type weights (`offline_card`): `apps/user-service/src/config/report-weights.config.ts`

---

*Last updated against current `backend-hmm` HEAD for OFFLINE cards behavior. Validate response payloads against your deployed environment if gateway/service versions differ.*

