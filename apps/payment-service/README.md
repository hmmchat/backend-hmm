# payment-service

Handles **buy coins** via Razorpay (orders, verify, webhooks) and credits the wallet-service.

Conventions:
- REST under `/v1/payments`
- Health: `GET /v1/payments/health`
- Ready: `GET /v1/payments/ready`

## Buy-coins flow

1. `GET /v1/payments/purchase/packages` — catalogue (public)
2. `POST /v1/payments/purchase/initiate` — body `{ "packageId": "coin_pack_100" }` (auth)  
   Creates a Razorpay order using the **package catalogue price**, returns `razorpayOrderId` + `razorpayKeyId`
3. Client opens Razorpay Checkout, then `POST /v1/payments/purchase/verify` with payment id / order id / signature
4. `POST /v1/payments/webhooks/razorpay` — Razorpay server callback (public, HMAC-verified); source of truth for credit if client verify is missed  
   Idempotent with client verify (order credited once)

## Required env

See `.env.example`. Minimum for buy-coins:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | payment-service Postgres |
| `JWT_PUBLIC_JWK` | Verify user access tokens |
| `RAZORPAY_KEY_ID` | Razorpay Key ID (test or live) |
| `RAZORPAY_KEY_SECRET` | Razorpay Key Secret (server only) |
| `RAZORPAY_WEBHOOK_SECRET` | Dashboard webhook signing secret |
| `WALLET_SERVICE_URL` | e.g. `http://localhost:3005` |

## Razorpay account setup (from scratch)

1. Sign up at [https://razorpay.com](https://razorpay.com) and complete business profile / KYC when ready for live mode. **Test mode** works before full activation.
2. Dashboard → **Account & Settings → API Keys** → Generate **Test** key. Copy Key ID + Key Secret into `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`.
3. Dashboard → **Account & Settings → Webhooks** → Add endpoint:  
   `https://<your-api-host>/v1/payments/webhooks/razorpay`  
   Subscribe at least to `payment.captured` (optionally `payment.failed`). Copy the webhook secret → `RAZORPAY_WEBHOOK_SECRET`.
4. Local/dev: use [Razorpay test cards](https://razorpay.com/docs/payments/payments/test-card-upi-details/) and expose the gateway with a tunnel (ngrok / Cloudflare Tunnel) so webhooks can reach you. Client `verify` still credits if the webhook cannot reach localhost.
5. Frontend (optional fallback): set `NEXT_PUBLIC_RAZORPAY_KEY_ID` to the same **public** Key ID. Prefer the `razorpayKeyId` field returned from initiate.
6. Smoke test: buy the smallest pack → wallet balance increases → `payment_orders.status = COMPLETED` → webhook row `PROCESSED`.
7. Go-live: finish KYC → generate **Live** keys → update env → point the webhook at production → retest with a small real payment.

## Notes

- Initiate accepts **`packageId` only** (not a free-form coin amount). Prices default in `@hmm/common` `coin-packages`.
- Optional **`COIN_PACKAGES_JSON`**: JSON array override for coins/prices/offers without a code change. Set the **same** value on **payment-service** and **api-gateway**, then restart both. Invalid JSON falls back to defaults.
  - Fields: `id`, `coins`, `price`, optional `originalPrice`, `discount`, `popular`, `mostValue`, `sortOrder`, `displayPrice`.
- Never expose `RAZORPAY_KEY_SECRET` or `RAZORPAY_WEBHOOK_SECRET` to the browser.
- Webhook path must stay **public** on the API gateway (no JWT). Signature verification is mandatory.
