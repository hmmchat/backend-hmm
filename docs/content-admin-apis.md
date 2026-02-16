## Content Admin APIs (Prompts, Dares, Interests, Values)

This document lists the **backend admin APIs** that the **data/content team** can use to **create, update, and delete** user-facing content **without code deployments**.

Services involved:
- `streaming-service` – in-call **icebreakers** and **dares**
- `user-service` – **interests**, **values** (causes / what matters to users), and **brands**
- `friend-service` – **gifts** used in chat

> **Base URLs (local examples – replace with real env URLs):**
> - Streaming service: `http://localhost:3006`
> - User service: `http://localhost:3002`

All endpoints below are **admin/internal** and should be protected by whatever auth/gateway you use.

---

### 1. Icebreakers (streaming-service)

**Purpose:** Manage the list of icebreaker questions shown during calls.

**Base path:** `STREAMING_SERVICE_URL/streaming/admin/icebreakers`

- **List all icebreakers (active + inactive)**
  - **GET** `/streaming/admin/icebreakers`
  - **Response:**
    - `ok: true`
    - `icebreakers: Array<{ id, question, category, isActive, order, createdAt, updatedAt }>`

- **List only active icebreakers**
  - **GET** `/streaming/admin/icebreakers/active`
  - **Response:**
    - `ok: true`
    - `icebreakers: Array<{ id, question, category }>`

- **Create a new icebreaker**
  - **POST** `/streaming/admin/icebreakers`
  - **Body (JSON):**
    ```json
    {
      "question": "What's your favorite movie of the year?",
      "category": "fun",
      "order": 1
    }
    ```
    - `question` (string, required)
    - `category` (string, optional)
    - `order` (number, optional; used for ordering)
  - **Response:** `{ ok: true, icebreaker: { ... } }`

- **Update an existing icebreaker**
  - **PATCH** `/streaming/admin/icebreakers/:id`
  - **Body (JSON, all fields optional):**
    ```json
    {
      "question": "Updated question text",
      "category": "personal",
      "isActive": true,
      "order": 2
    }
    ```
  - **Response:** `{ ok: true, icebreaker: { ... } }`

- **Soft delete / deactivate an icebreaker**
  - **DELETE** `/streaming/admin/icebreakers/:id`
  - Marks `isActive = false` – question will no longer be used, but stays in DB.
  - **Response:** `{ ok: true }` (HTTP 204/200 depending on implementation)

- **Hard delete an icebreaker**
  - **DELETE** `/streaming/admin/icebreakers/:id/hard`
  - Permanently removes the row.

---

### 2. Dares (streaming-service)

**Purpose:** Manage the catalog of dares used in calls (`dareId`, text, category, ordering, active flag).

**Base path:** `STREAMING_SERVICE_URL/streaming/admin/dares`

> The user-facing API (`GET /streaming/rooms/:roomId/dares` and `/random`) now reads from this catalog.  
> Legacy hardcoded dares are only used as a fallback if the catalog is empty.

- **List all dares (active + inactive)**
  - **GET** `/streaming/admin/dares`
  - **Response:**
    - `ok: true`
    - `dares: Array<{ id, dareId, text, category, isActive, order, createdAt, updatedAt }>`

- **List only active dares**
  - **GET** `/streaming/admin/dares/active`
  - **Response:**
    - `ok: true`
    - `dares: Array<{ id, dareId, text, category, order }>`

- **Create a new dare**
  - **POST** `/streaming/admin/dares`
  - **Body (JSON):**
    ```json
    {
      "dareId": "dare-12",
      "text": "Do your best dance move",
      "category": "fun",
      "order": 12
    }
    ```
    - `dareId` (string, required, **must be unique**, used in call records)
    - `text` (string, required)
    - `category` (string, optional; e.g. `fun`, `personal`, `physical`)
    - `order` (number, optional; display order)
  - **Response:** `{ ok: true, dare: { ... } }`

- **Update an existing dare**
  - **PATCH** `/streaming/admin/dares/:id`
  - **Body (JSON, all fields optional):**
    ```json
    {
      "text": "Updated dare text",
      "category": "personal",
      "isActive": true,
      "order": 5
    }
    ```
  - **Response:** `{ ok: true, dare: { ... } }`

- **Soft delete / deactivate a dare**
  - **DELETE** `/streaming/admin/dares/:id`
  - Sets `isActive = false` – dare will not be offered in UI anymore.

- **Hard delete a dare**
  - **DELETE** `/streaming/admin/dares/:id/hard`
  - Permanently removes the catalog entry.  
    Existing historic `CallDare` records will still have `dareId`, but the text may fall back to `"Unknown dare"` in history views if no matching catalog or fallback exists.

---

### 3. Interests (user-service)

**Purpose:** Manage the catalog of interests users can pick from (max 4 per user).  
These feed discovery/matching and profile UI.

**Base path:** `USER_SERVICE_URL/admin/interests`

- **List all interests**
  - **GET** `/admin/interests`
  - **Response:**
    - `ok: true`
    - `interests: Array<{ id, name, genre, createdAt }>`

- **Create a new interest**
  - **POST** `/admin/interests`
  - **Body (JSON):**
    ```json
    {
      "name": "Photography",
      "genre": "creative"
    }
    ```
    - `name` (string, required, unique)
    - `genre` (string, optional; umbrella category used for matching)
  - **Response:** `{ ok: true, interest: { ... } }`

- **Update an interest**
  - **PATCH** `/admin/interests/:id`
  - **Body (JSON, all optional):**
    ```json
    {
      "name": "Travel Photography",
      "genre": "travel"
    }
    ```
  - **Response:** `{ ok: true, interest: { ... } }`

- **Delete an interest (hard delete)**
  - **DELETE** `/admin/interests/:id`
  - Permanently removes the interest row.
  - **Important:** This will fail if there are users who have this interest selected (FK constraint).  
    - Data team should either:
      - Reassign/migrate user interests first, **or**
      - Only delete unused interests.

---

### 4. Values / Causes (user-service)

**Purpose:** Manage the catalog of “values / causes” users can pick from (max 4 per user).

**Base path:** `USER_SERVICE_URL/admin/values`

- **List all values**
  - **GET** `/admin/values`
  - **Response:**
    - `ok: true`
    - `values: Array<{ id, name, createdAt }>`

- **Create a new value**
  - **POST** `/admin/values`
  - **Body (JSON):**
    ```json
    {
      "name": "Sustainability"
    }
    ```
    - `name` (string, required, unique)
  - **Response:** `{ ok: true, value: { ... } }`

- **Update a value**
  - **PATCH** `/admin/values/:id`
  - **Body (JSON, optional):**
    ```json
    {
      "name": "Environmental Sustainability"
    }
    ```
  - **Response:** `{ ok: true, value: { ... } }`

- **Delete a value (hard delete)**
  - **DELETE** `/admin/values/:id`
  - Permanently removes the value row.
  - **Important:** Will fail if users are still referencing this value (FK).  
    - Same caveat as interests: prefer to only delete values not in use, or migrate user data first.

---

### 5. Gifts (friend-service)

**Purpose:** Manage the catalog of gifts (stickers) that can be sent in chats.

**Base path:** `FRIEND_SERVICE_URL/admin/gifts`

- **List all gifts (active + inactive)**
  - **GET** `/admin/gifts`

- **List only active gifts**
  - **GET** `/admin/gifts/active`

- **Create a new gift**
  - **POST** `/admin/gifts`
  - **Body:**
    ```json
    {
      "giftId": "rocket",
      "name": "Rocket",
      "emoji": "🚀",
      "coins": 500,
      "diamonds": 500
    }
    ```

- **Update a gift**
  - **PATCH** `/admin/gifts/:id`
  - **Body (any subset):**
    ```json
    {
      "name": "Super Rocket",
      "emoji": "🚀",
      "coins": 600,
      "diamonds": 600,
      "isActive": true
    }
    ```

- **Soft delete / deactivate a gift**
  - **DELETE** `/admin/gifts/:id`  (sets `isActive = false`)

- **Hard delete a gift**
  - **DELETE** `/admin/gifts/:id/hard`

---

### 6. Brands (user-service) & logos

**Purpose:** Manage the brand catalog users can choose from (up to 5 per user), including logo URLs.

**Base path:** `USER_SERVICE_URL/admin/brands`

- **List all brands**
  - **GET** `/admin/brands`

- **Create a new brand**
  - **POST** `/admin/brands`
  - **Body:**
    ```json
    {
      "name": "Spotify",
      "domain": "spotify.com",
      "logoUrl": "https://cdn.example.com/brand-logos/spotify.png"
    }
    ```

- **Update a brand**
  - **PATCH** `/admin/brands/:id`
  - **Body (any subset):**
    ```json
    {
      "name": "Spotify",
      "domain": "spotify.com",
      "logoUrl": "https://cdn.example.com/brand-logos/spotify-v2.png"
    }
    ```

- **Delete a brand**
  - **DELETE** `/admin/brands/:id`
  - Hard delete. This will fail if any `user_brands` row still references the brand.

**Brand logo images:**

1. Upload the logo to files-service:
   - `POST FILES_SERVICE_URL/files/upload` with e.g. `folder=brand-logos`
   - Copy the `file.url` from the response.
2. Attach the logo URL to the brand via:
   - `PATCH USER_SERVICE_URL/admin/brands/:id`
   - Body: `{ "logoUrl": "<uploaded file url>" }`

---

### 7. Quick reference table

| Content type | Service | List | Create | Update | Soft delete | Hard delete |
|-------------|---------|------|--------|--------|-------------|-------------|
| Icebreakers | streaming-service | `GET /streaming/admin/icebreakers`, `GET /streaming/admin/icebreakers/active` | `POST /streaming/admin/icebreakers` | `PATCH /streaming/admin/icebreakers/:id` | `DELETE /streaming/admin/icebreakers/:id` | `DELETE /streaming/admin/icebreakers/:id/hard` |
| Dares | streaming-service | `GET /streaming/admin/dares`, `GET /streaming/admin/dares/active` | `POST /streaming/admin/dares` | `PATCH /streaming/admin/dares/:id` | `DELETE /streaming/admin/dares/:id` | `DELETE /streaming/admin/dares/:id/hard` |
| Interests | user-service | `GET /admin/interests` | `POST /admin/interests` | `PATCH /admin/interests/:id` | – (no soft-delete flag) | `DELETE /admin/interests/:id` |
| Values | user-service | `GET /admin/values` | `POST /admin/values` | `PATCH /admin/values/:id` | – (no soft-delete flag) | `DELETE /admin/values/:id` |
| Gifts | friend-service | `GET /admin/gifts`, `GET /admin/gifts/active` | `POST /admin/gifts` | `PATCH /admin/gifts/:id` | `DELETE /admin/gifts/:id` | `DELETE /admin/gifts/:id/hard` |
| Brands | user-service | `GET /admin/brands` | `POST /admin/brands` | `PATCH /admin/brands/:id` | – (no soft-delete flag) | `DELETE /admin/brands/:id` |

You can share this document directly with the data/content team as the **single source of truth** for managing user-facing prompt/config content via APIs.

