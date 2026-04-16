# Discovery: LOCATION promos, session flow, and APIs

This document describes how the **frontend** should integrate **LOCATION** discovery cards (city promos and **Anywhere in India**), **user** face cards, **raincheck**, **select-location** (accept on a location promo), and related **user-service** / **location** APIs. All paths assume the **API gateway** with the **`/v1`** prefix.

**Base URL:** `API_BASE` (e.g. `https://api.example.com`). Full path = `API_BASE` + path below.

**Auth:** Send `Authorization: Bearer <access_token>` on authenticated routes unless noted.

---

## 1. Concepts the UI must model

### 1.1 `sessionId`

Use a stable string for this discovery session (same as existing face-card / raincheck flows). Pass it on every discovery call.

### 1.2 Two card shapes from `GET /v1/discovery/card`

- **User card:** `card.userId` is present; there is no `card.type === "LOCATION"`.
- **LOCATION promo:** `card.type === "LOCATION"`. Fields include:
  - `city`: string for a specific city, or **`null`** for the global **Anywhere in India**–style promo.
  - `availableCount`: number of users surfaced for that promo.
  - `faceCardImageUrl` (optional): HTTPS URL from the admin catalog for that city or for the **`ANYWHERE_IN_INDIA`** row.

### 1.3 Constants

- Stored preferred city / catalog sentinel for “anywhere”: **`ANYWHERE_IN_INDIA`** (same as `PREFERRED_CITY_ANYWHERE_IN_INDIA` in `@hmm/common`).
- In the API, a LOCATION promo with **`city === null`** is the global “anywhere” card; align labels in the UI with product copy.

### 1.4 `persistPreference` on location accept

Used only on **`POST /v1/discovery/select-location`**:

- **`true`:** Updates the user’s **profile** preferred city (and related server-side session reset behavior).
- **`false`:** Updates only the **in-session** discovery pool (e.g. user tapped a LOCATION face card without persisting profile city).

### 1.5 User “accept / meet now” vs location accept

- **`POST /v1/discovery/proceed`** — proceed with a **matched user** (`matchedUserId`). This is **not** for choosing a city on a LOCATION card.
- **`POST /v1/discovery/select-location`** — user chose a **LOCATION** promo’s city (or anywhere). Use this for “accept” on a LOCATION card.

---

## 2. Suggested implementation steps

1. **Onboarding / settings (catalog)**  
   Load active options: **`GET /v1/discovery-city-options/active`**.  
   When saving preferred city from profile, use **`PATCH /v1/me/preferred-city`** (or your existing profile API if it already sends `preferredCity` aligned with catalog **`value`** strings).

2. **Enter discovery**  
   Create or reuse **`sessionId`**. Call **`GET /v1/discovery/card?sessionId=...`** (optional `&soloOnly=true` or `false`).

3. **Branch on response**  
   - If **`card.type === "LOCATION"`** (or equivalent shape): render LOCATION UI — image from **`faceCardImageUrl`** if present, city label from **`city`** or “Anywhere in India” when **`city === null`**, show **`availableCount`**.  
   - Else: render the normal **user** face card flow.

4. **Raincheck on a user card**  
   **`POST /v1/discovery/raincheck`** with **`{ sessionId, raincheckedUserId }`** where **`raincheckedUserId`** is the **`card.userId`** of the person being passed. Use **`nextCard`** from the response (or refetch with `GET …/card`).

5. **Pass / skip on a LOCATION card**  
   **`markRaincheck`** on the server is oriented around **real user IDs**. Safer options:
   - **Preferred:** treat “pass” as fetching the next card with **`GET /v1/discovery/card?sessionId=...`** again (LOCATION rotation is updated when cards are served), **or**
   - Coordinate with backend on a dedicated contract if you must use **`POST /v1/discovery/raincheck`** for LOCATION.

6. **Accept on a LOCATION card**  
   **`POST /v1/discovery/select-location`** with `sessionId`, `city` (catalog **`value`** or **`null`** for anywhere), and **`persistPreference`**.  
   Render **`nextCard`**: expect a **user** card when someone is available in that pool; otherwise the server may return another LOCATION or edge cases per deployment.

7. **Accept on a user card (proceed)**  
   **`POST /v1/discovery/proceed`** with **`{ matchedUserId }`** — unchanged match flow.

8. **Reset discovery session (optional)**  
   **`POST /v1/discovery/reset-session`** with **`{ sessionId }`** — clears session-scoped rainchecks and session pool override (see server implementation). Use when leaving discovery or “start fresh” if product requires it.

9. **Optional helpers**  
   - **`GET /v1/discovery/fallback-cities?limit=10`** — suggested cities.  
   - **`GET/POST /v1/location/...`** — city lists, search, preference (see table below).

---

## 3. API reference (gateway paths)

### 3.1 Discovery (authenticated)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/discovery/card` | Query: `sessionId` (required), `soloOnly` optional. Returns next card (user or LOCATION), `exhausted`, optional `suggestedCities` and `isLocationCard`. |
| POST | `/v1/discovery/raincheck` | JSON body: `sessionId`, `raincheckedUserId`. Response: `success`, `nextCard`. On user cards, set `raincheckedUserId` to `card.userId`. |
| POST | `/v1/discovery/select-location` | JSON body: `sessionId`, `city` (string or `null`), `persistPreference` (optional, default `true`). Response: `success`, `nextCard`, `isLocationCard`. |
| POST | `/v1/discovery/proceed` | JSON body: `matchedUserId`. Proceed with matched user. |
| POST | `/v1/discovery/reset-session` | JSON body: `sessionId`. Clears session-scoped discovery state. |
| GET | `/v1/discovery/fallback-cities` | Query: `limit` (1–50). Suggested cities (optional product feature). |

DTOs: `apps/discovery-service/src/dtos/discovery.dto.ts` (e.g. `SelectLocationRequestSchema` defaults `persistPreference` to `true`).

### 3.2 User service — catalog and preferred city

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/discovery-city-options/active` | Active discovery city options: `value`, `label`, optional `faceCardImageUrl` for pickers and copy. |
| PATCH | `/v1/me/preferred-city` | Set stored preferred city; must match catalog values or `ANYWHERE_IN_INDIA`. |

### 3.3 Location (supporting APIs)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/location/cities` | Query: `limit`. Cities with user counts (auxiliary). |
| GET | `/v1/location/search` | Query: `q`, `limit`. City search. |
| POST | `/v1/location/locate-me` | JSON body: latitude and longitude → resolved city. |
| GET | `/v1/location/preference` | Authenticated: current user’s preferred city. |

### 3.4 Admin (dashboard; not typical mobile/web app)

| Method | Path | Purpose |
| --- | --- | --- |
| GET, POST, PATCH, DELETE | `/v1/admin/discovery-city-options` | Manage catalog and face-card image URLs (Beam dashboard). |

---

## 4. Request / response examples

### 4.1 Select a city from a LOCATION card (session-only pool)

```http
POST /v1/discovery/select-location
Content-Type: application/json
Authorization: Bearer <token>
```

```json
{
  "sessionId": "your-session-id",
  "city": "Bengaluru",
  "persistPreference": false
}
```

### 4.2 Select “anywhere” from the global LOCATION promo

```json
{
  "sessionId": "your-session-id",
  "city": null,
  "persistPreference": false
}
```

### 4.3 Raincheck a user card

```json
{
  "sessionId": "your-session-id",
  "raincheckedUserId": "<card.userId>"
}
```

### 4.4 LOCATION card (illustrative)

```json
{
  "type": "LOCATION",
  "city": "Bengaluru",
  "availableCount": 42,
  "faceCardImageUrl": "https://cdn.example.com/..."
}
```

For the global anywhere promo, **`city`** is **`null`**; **`faceCardImageUrl`** may be set from the catalog row whose value is **`ANYWHERE_IN_INDIA`**.

---

## 5. TypeScript modeling tip

Use a **discriminated union** on the card payload:

- **`card.type === "LOCATION"`** → LOCATION layout; primary action calls **`select-location`** with the chosen `city` or `null`.
- **Otherwise** → user card layout; **raincheck** / **proceed** as in existing discovery flows.

---

## 6. Source references (backend repo)

- Discovery routes: `apps/discovery-service/src/routes/discovery.controller.ts`
- Discovery DTOs: `apps/discovery-service/src/dtos/discovery.dto.ts`
- LOCATION / pool logic: `apps/discovery-service/src/services/discovery.service.ts`
- Preferred-city sentinel: `packages/common/src/preferred-city.ts`
- Active catalog: `apps/user-service/src/routes/user.controller.ts` (`GET discovery-city-options/active`)
- Gateway routing: `apps/api-gateway/src/services/routing.service.ts`

---

*Last updated to match `backend-hmm` discovery and user-service behavior; verify against your deployed gateway if response shapes differ by version.*
