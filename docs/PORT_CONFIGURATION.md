# Port Configuration

Canonical port assignment for local development. All services respect `PORT` env var; these are defaults and fallbacks.

| Service            | Port | Default URL                  |
|--------------------|------|------------------------------|
| API Gateway        | 3000 | `http://localhost:3000`      |
| Auth Service       | 3001 | `http://localhost:3001`      |
| User Service       | 3002 | `http://localhost:3002`      |
| Moderation Service | 3003 | `http://localhost:3003`      |
| Discovery Service  | 3004 | `http://localhost:3004`      |
| Streaming Service  | 3005 | `http://localhost:3005`      |
| Wallet Service     | 3006 | `http://localhost:3006`      |
| Payment Service    | 3007 | `http://localhost:3007`      |
| Files Service      | 3008 | `http://localhost:3008`      |
| Friend Service     | 3009 | `http://localhost:3009`      |

## Environment variables

API Gateway and other consumers use:

- `AUTH_SERVICE_URL`, `USER_SERVICE_URL`, …
- `FRIEND_SERVICE_URL` → **3009**
- `PAYMENT_SERVICE_URL` → **3007**
- `FILES_SERVICE_URL` → **3008**
- etc.

Keep fallbacks in `routing.service.ts`, `health.service.ts`, and service clients aligned with this table.

## References

- `apps/*/src/main.ts` – service `PORT` defaults
- `tests/test-utils.sh` – `*_PORT` / `*_URL` for E2E
- `apps/api-gateway/README.md` – `.env` example
