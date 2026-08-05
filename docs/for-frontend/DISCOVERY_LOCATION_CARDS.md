# Discovery: city handoff, LOCATION cards, and APIs

This document describes how the **frontend** integrates **end-of-deck city handoff**, **LOCATION** face cards, **user** face cards, **raincheck**, **select-location** (session city hop), and related APIs. All paths assume the **API gateway** with the **`/v1`** prefix.

**Base URL:** `API_BASE` (e.g. `https://api.example.com`). Full path = `API_BASE` + path below.

**Auth:** Send `Authorization: Bearer <access_token>` on authenticated routes unless noted.

---

## 1. Concepts the UI must model

### 1.1 `sessionId`

Use a stable string for this discovery session. Pass it on every discovery call.

### 1.2 Card shapes from `GET /v1/discovery/card`

- **User card:** `card.userId` is present; there is no `card.type === "LOCATION"`.
- **LOCATION handoff card:** `card.type === "LOCATION"`. Returned only when the current pool has **no showable users** for you, but another catalog city does. Fields:
  - `city`: string (specific city; not null for live handoff)
  - `availableCount`: ranking/validity only — **do not display** counts in UI
  - `faceCardImageUrl` (optional)
  - `intent` (required on publishable cities): city vibe for the intent strip
  - `label` (optional): display name
- **Empty orbit:** `{ card: null, exhausted: true }` when no city has showable-for-you users.

A city is **showable** only if someone would actually appear on *your* discovery deck there (same filters as normal discovery) **and** the admin catalog row has a non-empty **intent**.

### 1.3 Deck phases (frontend)

| Phase | When | UI |
| --- | --- | --- |
| `user` | User face card | Raincheck + Meet rn |
| `cityHandoff` | LOCATION card returned | City face card + `Hopping to {city} — the vibe’s still up` + countdown + Cancel. **No** Meet rn / Raincheck |
| `cityBoxes` | Handoff cancelled or handoff city went invalid | 0–3 name-only city boxes (tap → session hop) |
| `emptyOrbit` | Nowhere showable | `Empty orbit. Hang here; someone always beams in.` + quiet poll |

Countdown default **5s** (`CITY_HANDOFF_COUNTDOWN_SECONDS`). Quiet poll default **3s** (`DISCOVERY_AVAILABLE_CITIES_POLL_MS`). Both also exposed via `GET /v1/discovery/ui-config` and embedded on `available-cities`.

### 1.4 `persistPreference` on location accept

Used only on **`POST /v1/discovery/select-location`**:

- **`true`:** Updates the user’s **profile** preferred city.
- **`false`:** Session hop only (`SessionDiscoveryCityOverride`) — **saved city unchanged**. Use this for handoff auto-advance and city-box taps.

### 1.5 Meet rn vs city hop

- **`POST /v1/discovery/proceed`** — Meet rn on a **user** card only → waiting / call.
- **`POST /v1/discovery/select-location`** — enter a city’s deck (countdown complete or box tap). **Never** wire Meet rn to this.

---

## 2. Suggested implementation steps

1. **Catalog** — `GET /v1/discovery-city-options/active` includes `intent`. Dashboard requires intent before a city can be active/published.

2. **Enter discovery** — `POST /discovery/session/enter` then `GET /discovery/card?sessionId=...`.

3. **Branch on response**
   - User card → user phase (Meet rn / Raincheck).
   - LOCATION → city handoff (countdown → `select-location` with `persistPreference: false`).
   - `exhausted: true` → empty orbit; poll `available-cities` + occasional `GET /card` for recovery.

4. **Cancel handoff** — `GET /discovery/available-cities?sessionId=&limit=3`. Show up to 3 name-only boxes (diff-only updates). Tap → `select-location` (`persistPreference: false`).

5. **Handoff validity** — while countdown runs, poll `available-cities`. If the handoff city drops out, cancel to boxes / empty.

6. **Empty recovery** — if same pool gains users, `GET /card` returns a user card; if other cities have users, show boxes; else stay on empty copy.

7. **Raincheck** — user cards only: `POST /discovery/raincheck`.

8. **Reset (optional)** — `POST /discovery/reset-session`.

---

## 3. API reference (gateway paths)

### 3.1 Discovery (authenticated)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/discovery/my-room` | Auth required. Redis room assignment after mutual Meet rn (`roomId`, `sessionId`, `hasRoom`). Waiting clients should poll this first. |
| GET | `/v1/discovery/card` | Query: `sessionId`, `soloOnly`. User card, LOCATION handoff, or `{ card: null, exhausted: true }`. |
| GET | `/v1/discovery/available-cities` | Query: `sessionId`, `limit` (1–50, default 3), `soloOnly`, optional `excludeCity`. Returns `{ cities: [{ city, label, intent, faceCardImageUrl, availableCount }], ui: { cityHandoffCountdownSeconds, availableCitiesPollMs } }`. Cities are showable-for-you, intent required, ordered by count desc. |
| GET | `/v1/discovery/ui-config` | `{ ok, cityHandoffCountdownSeconds, availableCitiesPollMs }` from env. |
| POST | `/v1/discovery/raincheck` | User pass only. |
| POST | `/v1/discovery/select-location` | Session (or profile) city hop. Prefer `persistPreference: false` for handoff/boxes. |
| POST | `/v1/discovery/proceed` | Meet rn (user cards). |
| POST | `/v1/discovery/reset-session` | Clear session rainchecks + session pool override. |
| GET | `/v1/discovery/fallback-cities` | Legacy loose city counts (prefer `available-cities` for product UI). |

### 3.2 User service — catalog and preferred city

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/discovery-city-options/active` | Active options: `value`, `label`, `intent`, `faceCardImageUrl`, `order`. |
| PATCH | `/v1/me/preferred-city` | Set stored preferred city. |
| Admin | `/v1/admin/discovery-city-options` | CRUD; **intent required** to create / keep active. |

### 3.3 Location (supporting)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/location/cities` | Auxiliary city counts (not showable-for-you). |
| GET | `/v1/location/search` | City search. |
| POST | `/v1/location/locate-me` | Reverse geocode. |
| GET | `/v1/location/preference` | Current preferred city. |

---

## 4. Copy (locked)

- Handoff: `Hopping to {city} — the vibe’s still up`
- Empty: `Empty orbit. Hang here; someone always beams in.`
- Do not show user-count numbers on city face cards or boxes.

---

## 5. Env knobs (discovery-service)

| Env | Default | Meaning |
| --- | --- | --- |
| `CITY_HANDOFF_COUNTDOWN_SECONDS` | `5` | Auto-advance into next city |
| `CITY_HANDOFF_VALIDITY_POLL_MS` | `3000` | Poll while countdown is active (abort if city empties) |
| `DISCOVERY_AVAILABLE_CITIES_POLL_MS` | `8000` | Poll on city boxes / empty orbit |

**Stability rules**

- Meet rn waiting / in-call: hard stop handoff/boxes/empty polling and countdown.
- Cancel wins over a late countdown complete.
- Failed / empty `select-location` at countdown end → boxes / empty (never stuck on dead handoff).
- Raincheck-from-call resume: clear handoff UI state, then clean `GET /card`.

---

## 6. Related code

- Backend: `apps/discovery-service/src/services/discovery.service.ts` (`listShowableCities`, `resolveEmptyPoolHandoff`)
- Frontend: `components/Home/hooks/useMeetSomeone.js` (`deckPhase`)
- Dashboard: `DiscoveryCitiesSection` intent field
