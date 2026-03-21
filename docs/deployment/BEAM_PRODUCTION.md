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
| `DISCOVERY_SERVICE_URL` | Same idea; often `https://api.beam.place` when using nginx S2S (below). |
| `FRIEND_SERVICE_URL` | Friend-service base URL; use `https://api.beam.place` with nginx paths `^~ /internal/friends/`. |
| `WALLET_SERVICE_URL` | Wallet-service base URL; use `https://api.beam.place` with nginx paths `^~ /test/...`. |
| `REDIS_URL` | e.g. `redis://<backend-public-ip>:6380` when using the **nginx stream** Redis proxy (below). |
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

## DigitalOcean firewall + split droplets

If the **streaming** droplet can open **Postgres (5432)** to the **backend** public IP but **not** `4001` / `4004`, the cloud firewall is blocking those ports. Options:

1. **Firewall rules:** allow TCP `4001`, `4004`, `4009`, `4005` (and `6379` if Redis is used) from the streaming droplet’s public IP to the backend droplet.

2. **Nginx on `api.beam.place` (HTTPS, port 443):** proxy paths only for service-to-service calls from the streaming IP, for example:
   - `location ^~ /users/test/` → `http://127.0.0.1:4001` with `allow <streaming-public-ip>; deny all;`
   - `location ^~ /discovery/internal/` → `http://127.0.0.1:4004` with the same `allow`.

   Then set on the streaming host:

   - `USER_SERVICE_URL=https://api.beam.place`
   - `DISCOVERY_SERVICE_URL=https://api.beam.place`

   Ensure **no duplicate** `server_name` `.conf` files remain under `sites-enabled` (move backups elsewhere) after editing nginx.

3. **Friend + wallet (HTTPS, same host):** add locations restricted to the streaming IP (same pattern as above):
   - `location ^~ /internal/friends/` → `http://127.0.0.1:4009` (pass `x-service-token` from the client request).
   - `location ^~ /test/transactions/` → `http://127.0.0.1:4005`
   - `location ^~ /test/wallet/` → `http://127.0.0.1:4005`
   - `location ^~ /test/balance` → `http://127.0.0.1:4005`

   Then on the streaming host:

   - `FRIEND_SERVICE_URL=https://api.beam.place`
   - `WALLET_SERVICE_URL=https://api.beam.place`

4. **Redis (TCP):** the streaming app may use `REDIS_URL` to reach Redis on the main droplet. HTTP proxies cannot speak the Redis protocol; use **nginx `stream`** to forward TCP:

   - Install: `apt install libnginx-mod-stream`
   - Append to **`/etc/nginx/nginx.conf`** (outside `http { }`):

   ```nginx
   stream {
       upstream redis_s2s {
           server 127.0.0.1:6379;
       }
       server {
           listen 6380;
           allow <STREAMING_PUBLIC_IP>;
           deny all;
           proxy_pass redis_s2s;
           proxy_connect_timeout 10s;
       }
   }
   ```

   - Set on streaming: `REDIS_URL=redis://<BACKEND_PUBLIC_IP>:6380`
   - **Cloud firewall:** allow inbound **TCP 6380** from the streaming droplet’s public IP. If 6380 is not open, `nc` / Redis clients will time out (same class of issue as blocked 4001).

See also: `docs/deployment/nginx-api-beam-s2s.example.conf` for a commented template.

## 5. WebSocket (`wss://api.beam.place/streaming/ws`)

Browsers connect with **`wss://api.beam.place/streaming/ws`** (or optionally **`/v1/streaming/ws`** — add the rewrite in nginx). The API gateway does **not** proxy WebSockets; nginx must forward the HTTP **Upgrade** to **streaming-service** directly.

1. In **`/etc/nginx/nginx.conf`**, inside `http { }`, ensure a `map` exists (once):

   ```nginx
   map $http_upgrade $connection_upgrade {
       default upgrade;
       ''      close;
   }
   ```

2. In the **`server { ... }`** for `api.beam.place` (HTTPS), add **`location ^~ /streaming/ws`** (and optionally **`/v1/streaming/ws`**) **before** `location /` that points at the gateway. Use **`proxy_pass`** to streaming’s HTTP port (**`3006`** in this repo’s `docker-compose`; adjust if your prod port differs):

   - Streaming runs **on the same droplet** as nginx → `http://127.0.0.1:3006`
   - Streaming runs **on another droplet** → `http://<streaming-host>:3006` and allow **TCP 3006** from this nginx host in the cloud firewall (or use private networking).

3. Include WebSocket headers: `Upgrade`, `Connection: $connection_upgrade`, `Authorization` (JWT), long `proxy_read_timeout` / `proxy_send_timeout` (e.g. 86400s). Full snippet: **`docs/deployment/nginx-api-beam-s2s.example.conf`** section **3**.

4. `nginx -t && systemctl reload nginx`

5. Point the app at **`wss://api.beam.place/streaming/ws`** with the same access token the REST API uses (header is forwarded by nginx).

**Deploy note:** Do not leave backup copies of `api.beam.place` (e.g. `*.bak`) inside **`/etc/nginx/sites-enabled/`** — nginx loads every file there, duplicate `server_name api.beam.place` blocks are ignored and the wrong vhost may win. Keep backups under `/root/nginx-backups/` or similar.
