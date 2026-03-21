# Beam production: discovery ↔ streaming ↔ user-service

## Fixes in this repo (status + timeouts)

1. **Discovery `updateUserStatus`** now calls **user-service HTTP first** (`PATCH /users/test/:userId/status`). The discovery database does not have a `users` table; direct SQL against discovery’s DB caused `relation "users" does not exist`. Optional legacy path: set `DISCOVERY_STATUS_USE_DIRECT_DB=true` only if discovery shares the same Postgres as user-service.

2. **Squad status updates** use `MatchingService.updateUserStatus` (same HTTP path) instead of raw SQL on discovery.

3. **Streaming → user-service** HTTP calls use **`USER_SERVICE_TIMEOUT_MS`** (default **15000** ms) and `AbortSignal.timeout` so status checks fail fast instead of hanging.

4. **Discovery → streaming** `createMatchedRoom` uses **`STREAMING_SERVICE_TIMEOUT_MS`** (default **30000** ms) so room creation can complete when streaming waits on user-service twice.

## Required environment variables

### Discovery (`beam-backend` / wherever discovery runs)

| Variable | Purpose |
|----------|---------|
| `USER_SERVICE_URL` | Base URL of user-service **reachable from this host** (e.g. private IP + port). |
| `STREAMING_SERVICE_URL` | Base URL of streaming-service **reachable from this host**. |
| `USER_SERVICE_STATUS_TIMEOUT_MS` | Optional; default 10000. |

### Streaming (`beam-streaming`)

| Variable | Purpose |
|----------|---------|
| `USER_SERVICE_URL` | Base URL of user-service **reachable from the streaming host** (must not be an unroutable IP). |
| `USER_SERVICE_TIMEOUT_MS` | Optional; default 15000. |

### User-service

Must listen on an address/port that **both** discovery and streaming can reach (firewall / VPC / Docker network).

## Deploying code to your droplets

Automated SSH from CI was not used (no deploy key configured here). On each server:

1. Pull or copy this repository.
2. Rebuild the affected services (`discovery-service`, `streaming-service`).
3. Restart processes (Docker Compose, PM2, or systemd).
4. Confirm env vars above in your process manager or `.env`.

**Security:** Do not commit passwords or paste them into scripts. Rotate any credential that was shared in plain text.

## Verify connectivity

From the **streaming** host:

```bash
curl -sS -m 5 "${USER_SERVICE_URL}/health" || curl -sS -m 5 "${USER_SERVICE_URL}/users/test/<userId>?fields=status"
```

From the **discovery** host:

```bash
curl -sS -m 5 "${STREAMING_SERVICE_URL}/health"
curl -sS -m 5 "${USER_SERVICE_URL}/health"
```

Replace URLs with the values your services actually use in production.
