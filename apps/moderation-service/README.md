# Moderation Service

Content moderation service for HMM backend. Handles NSFW (Not Safe For Work) checks for images.

## Overview

This service validates images to ensure they are safe for work before they are accepted by user-service. It supports multiple moderation providers:

- **Mock** (default, for development) - Simple keyword-based check
- **Sightengine** - Production-ready image moderation API
- **Google Vision API** - Google's SafeSearch detection
- **AWS Rekognition** - Amazon's content moderation (requires AWS SDK)

## Setup

### 1. Install Dependencies

```bash
cd apps/moderation-service
npm install
```

### 2. Environment Variables

Create `.env` file:

```env
PORT=3003
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173

# Moderation Provider (mock | sightengine | google | aws)
MODERATION_PROVIDER=mock

# For Sightengine (when MODERATION_PROVIDER=sightengine)
MODERATION_API_URL=https://api.sightengine.com/1.0/check.json
MODERATION_API_KEY=your_sightengine_api_key

# For Google Vision (when MODERATION_PROVIDER=google)
MODERATION_API_KEY=your_google_vision_api_key

# For AWS Rekognition (when MODERATION_PROVIDER=aws)
# Requires AWS SDK and credentials configured
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
```

### 3. Start Service

```bash
# Development
npm run start:dev

# Production
npm run build
npm start
```

## API Endpoints

### Check Image

**Endpoint:** `POST /moderation/check-image`

**Request:**
```json
{
  "imageUrl": "https://example.com/image.jpg"
}
```

**Response (Safe):**
```json
{
  "safe": true,
  "confidence": 0.95,
  "categories": {
    "adult": 0.1,
    "racy": 0.1,
    "violence": 0.05
  }
}
```

**Response (Unsafe):**
```json
{
  "safe": false,
  "confidence": 0.9,
  "categories": {
    "adult": 0.9,
    "racy": 0.7
  }
}
```

## Provider Setup

### Mock Provider (Development)

Default provider, no API key needed. Uses simple keyword matching:
- Rejects URLs containing: "nsfw", "explicit", "adult", "xxx"
- Accepts all other URLs

Good for development and testing.

### Sightengine (Recommended for Production)

1. Sign up at https://sightengine.com/
2. Get API key from dashboard
3. Set environment variables:
   ```env
   MODERATION_PROVIDER=sightengine
   MODERATION_API_URL=https://api.sightengine.com/1.0/check.json
   MODERATION_API_KEY=your_api_key
   ```

**Pricing:** Free tier available (5,000 calls/month)

### Google Vision API

1. Create project in Google Cloud Console
2. Enable Vision API
3. Create API key
4. Set environment variables:
   ```env
   MODERATION_PROVIDER=google
   MODERATION_API_KEY=your_api_key
   ```

**Pricing:** $1.50 per 1,000 images

### AWS Rekognition

1. Configure AWS credentials (via environment or AWS CLI)
2. Set environment variables:
   ```env
   MODERATION_PROVIDER=aws
   AWS_REGION=us-east-1
   ```
3. Install AWS SDK: `npm install @aws-sdk/client-rekognition`

**Pricing:** $1.00 per 1,000 images

## Integration with User Service

User-service automatically calls this service when:
- User creates profile with display picture
- User adds photos to profile

If moderation check fails, the request is rejected with a clear error message.

## Testing

See `TESTING.md` for detailed testing instructions.

### Quick Test

```bash
# Start moderation service
cd apps/moderation-service
npm run start:dev

# Test with safe image
curl -X POST http://localhost:3003/moderation/check-image \
  -H "Content-Type: application/json" \
  -d '{"imageUrl": "https://example.com/safe-image.jpg"}'

# Test with unsafe image (mock provider will reject URLs with "nsfw" keyword)
curl -X POST http://localhost:3003/moderation/check-image \
  -H "Content-Type: application/json" \
  -d '{"imageUrl": "https://example.com/nsfw-image.jpg"}'
```

## Error Handling

- **Service Unavailable (503):** Moderation service is down or unreachable
- **Bad Request (400):** Invalid image URL or validation failed
- **Safe = false:** Image failed moderation check

User-service handles these errors and returns appropriate responses to the client.
