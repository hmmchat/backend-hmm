# Ads Service

Ad reward management service for HMM backend. Handles rewarded ad verification, coin distribution, and ad reward configuration.

## Overview

This service manages the ad-based coin rewards system where users can watch ads (via Google Ad Manager or AdSense) to earn coins. The service tracks ad views, verifies completion, enforces cooldown periods and daily limits, and awards configurable coin amounts through the wallet service.

## Features

- Ad reward verification and coin distribution
- Cooldown period enforcement (prevents abuse)
- Daily limit enforcement (optional)
- Ad reward history tracking
- Configurable reward amounts and limits
- Integration with wallet-service for coin crediting

## API Endpoints

### Authenticated Endpoints

- `POST /me/ads/reward/verify` - Verify ad completion and award coins
- `GET /me/ads/reward/history` - Get user's ad reward history

### Public Endpoints

- `GET /ads/reward/config` - Get current reward configuration
- `POST /ads/reward/config` - Update reward configuration (Admin only)

### Test Endpoints (No Auth)

- `POST /test/ads/reward/verify` - Test ad reward verification
- `GET /test/ads/reward/history` - Test reward history retrieval

### Health Endpoints

- `GET /health` - Health check
- `GET /ready` - Readiness check

## Environment Variables

See `.env.example` for all required environment variables.

### Required

- `PORT` - Service port (default: 3010)
- `DATABASE_URL` - PostgreSQL connection string
- `WALLET_SERVICE_URL` - Wallet service URL (default: http://localhost:3005)
- `JWT_PUBLIC_JWK` - JWT public key for authentication

### Optional Configuration

- `AD_REWARD_COINS_PER_AD` - Coins awarded per ad (default: 10)
- `AD_REWARD_COOLDOWN_SECONDS` - Minimum seconds between ads (default: 300)
- `AD_REWARD_MAX_PER_DAY` - Maximum ads per user per day (optional, null = no limit)
- `AD_REWARD_ENABLED` - Enable/disable ad rewards (default: true)

## Database Schema

### AdReward

Tracks individual ad reward transactions:

- `id` - Unique identifier
- `userId` - User who watched the ad
- `adUnitId` - Ad unit identifier from ad network
- `adNetwork` - Ad network name (AdManager, AdSense, etc.)
- `coinsAwarded` - Number of coins awarded
- `eCPM` - Revenue per 1000 impressions (if available)
- `revenue` - Actual revenue earned in INR (if available)
- `status` - Reward status (PENDING, VERIFIED, FAILED, REVOKED)
- `verifiedAt` - Timestamp when reward was verified
- `createdAt` - Timestamp when ad was watched

### AdRewardConfig

Stores reward configuration:

- `adType` - Type of ad (default: "rewarded_video")
- `coinsPerAd` - Coins awarded per ad
- `isActive` - Whether rewards are enabled
- `minCooldown` - Minimum seconds between ads
- `maxAdsPerDay` - Maximum ads per user per day (optional)

## Usage

### Verify Ad Reward

```bash
POST /v1/ads/reward/verify
Authorization: Bearer <token>
Content-Type: application/json

{
  "adUnitId": "/12345678/rewarded-video",
  "adNetwork": "AdManager"
}
```

Response:
```json
{
  "success": true,
  "coinsAwarded": 10,
  "newBalance": 150,
  "transactionId": "clx..."
}
```

### Get Reward History

```bash
GET /v1/ads/reward/history?limit=50&offset=0
Authorization: Bearer <token>
```

### Get Configuration

```bash
GET /v1/ads/reward/config
```

## Setup

1. Copy `.env.example` to `.env` and fill in values
2. Install dependencies: `npm ci`
3. Generate Prisma client: `npm run prisma:generate`
4. Run migrations: `npm run prisma:migrate`
5. Start service: `npm run start:dev`

## Integration with Frontend

The frontend should:

1. Load Google Publisher Tag (GPT) JavaScript library
2. Initialize rewarded ad slot
3. Listen for `rewardedSlotVideoCompleted` event
4. Call `POST /v1/ads/reward/verify` with `adUnitId` and `userId`
5. Update UI with new coin balance from response

See the main plan document for detailed frontend integration guide.

## Anti-Fraud Measures

- **Cooldown Period**: Enforces minimum time between ad views
- **Daily Limit**: Optional maximum ads per user per day
- **Status Tracking**: Prevents duplicate rewards (PENDING → VERIFIED)
- **Rate Limiting**: API rate limits (handled by API Gateway)

## Notes

- Rewards are verified client-side (ad completion event) and then verified server-side
- Coins are credited through wallet-service integration
- Configuration can be updated via API (should add admin auth)
- All ad reward transactions are logged for audit purposes
