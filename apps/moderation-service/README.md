# Moderation Service

Content moderation service for HMM backend. Validates profile photos to ensure they are appropriate.

## Overview

This service validates images (display pictures and user photos) to ensure they meet the following criteria:
1. **Human Detection**: Image must contain a human person (not objects, landscapes, or other non-human content)
2. **NSFW Check**: No nudity or adult content
3. **Appropriateness**: No violence, offensive, or inappropriate content

It supports multiple moderation providers:

- **Mock** (default, for development) - Simple keyword-based check
- **Sightengine** - Production-ready image moderation API (supports face detection and content moderation)
- **Google Vision API** - Google Cloud Vision API for content moderation
- **AWS Rekognition** - AWS Rekognition for content moderation (requires AWS SDK)

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
  "isHuman": true,
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
  "isHuman": false,
  "categories": {
    "adult": 0.9,
    "racy": 0.7
  },
  "failureReasons": [
    "Image must contain a human person. Please upload a photo of yourself.",
    "Image contains inappropriate adult content. Please upload a safe, appropriate photo."
  ]
}
```

**Response Fields:**
- `safe` (boolean): Whether the image passes all moderation checks
- `confidence` (number): Confidence score (0-1)
- `isHuman` (boolean): Whether the image contains a human person
- `categories` (object): Scores for different content categories
- `failureReasons` (string[]): Specific reasons why the image was rejected (only present when safe = false)

## Provider Setup

### Mock Provider (Development)

**⚠️ CRITICAL LIMITATION:** The mock provider only checks URL keywords, **NOT actual image content**.

**What it does:**
- **Human Detection**: Rejects URLs containing: "object", "thing", "landscape", "animal", "car"
- **NSFW Detection**: Rejects URLs containing: "nsfw", "explicit", "adult", "xxx"
- Accepts all other URLs (assumes human and safe)

**What it does NOT do:**
- ❌ Does NOT download or analyze the actual image
- ❌ Does NOT detect nudity if URL is clean (e.g., "profile.jpg" with actual nudity will pass)
- ❌ Does NOT detect inappropriate content in the image pixels

**Example:**
```bash
# This will be marked as SAFE by mock provider (incorrect if image has nudity!)
curl -X POST http://localhost:3003/moderation/check-image \
  -H "Content-Type: application/json" \
  -d '{"imageUrl": "https://example.com/clean-profile.jpg"}'
# Response: {"safe": true, ...} ← Even if image contains nudity!

# This will be marked as UNSAFE (only because of keyword in URL)
curl -X POST http://localhost:3003/moderation/check-image \
  -H "Content-Type: application/json" \
  -d '{"imageUrl": "https://example.com/nsfw-image.jpg"}'
# Response: {"safe": false, ...} ← Correct, but only due to keyword
```

**⚠️ For Production:** You MUST use a real provider (Sightengine, Google Vision, or AWS Rekognition) that actually analyzes image content. The mock provider is ONLY for development/testing.

### Sightengine (Recommended for Production)

✅ **Actually analyzes image content** - Downloads and analyzes the actual image pixels, not just URL names.

1. Sign up at https://sightengine.com/
2. Get API key from dashboard
3. Set environment variables:
   ```env
   MODERATION_PROVIDER=sightengine
   MODERATION_API_URL=https://api.sightengine.com/1.0/check.json
   MODERATION_API_KEY=your_api_key
   ```

**How it works:**
- Downloads image from URL
- Analyzes pixels for nudity, adult content, violence
- Detects faces to verify human presence
- Works regardless of URL name

**Pricing:** Free tier available (5,000 calls/month)

### Google Vision API

✅ **Actually analyzes image content** - Downloads and analyzes the actual image pixels using Google's ML models.

1. Create project in Google Cloud Console
2. Enable Vision API
3. Create API key
4. Set environment variables:
   ```env
   MODERATION_PROVIDER=google
   MODERATION_API_KEY=your_api_key
   ```

**How it works:**
- Downloads image from URL
- Uses Google's SafeSearch ML models
- Detects nudity, adult content, violence in actual pixels
- Works regardless of URL name

**Pricing:** $1.50 per 1,000 images

### AWS Rekognition

✅ **Actually analyzes image content** - Downloads and analyzes the actual image pixels using AWS ML models.

1. Configure AWS credentials (via environment or AWS CLI)
2. Set environment variables:
   ```env
   MODERATION_PROVIDER=aws
   AWS_REGION=us-east-1
   ```
3. Install AWS SDK: `npm install @aws-sdk/client-rekognition`

**How it works:**
- Downloads image from URL
- Uses AWS Rekognition ML models
- Detects inappropriate content in actual pixels
- Works regardless of URL name

**Pricing:** $1.00 per 1,000 images

## Integration with User Service

User-service automatically calls this service when:
- User creates profile with display picture URL
- User adds photos to profile

**Flow:**
1. User uploads photo to your file storage (e.g., Cloudflare R2, AWS S3)
2. Photo URL is sent to user-service
3. User-service calls moderation-service to validate the photo
4. Moderation service checks:
   - ✅ Contains a human person (not objects/landscapes/animals)
   - ✅ No NSFW content (nudity, adult content)
   - ✅ No violence or offensive content
5. If all checks pass, photo is accepted
6. If any check fails, request is rejected with specific error message

**⚠️ Important:** 
- **Mock Provider:** Only checks URL keywords, NOT actual image content. Use only for development.
- **Real Providers (Sightengine/Google/AWS):** Actually download and analyze image pixels. Required for production.

**Error Messages:**
- "Image must contain a human person. Please upload a photo of yourself." (if no human detected)
- "Image contains inappropriate adult content. Please upload a safe, appropriate photo." (if NSFW detected)
- "Image contains suggestive content. Please upload a more appropriate photo." (if racy content detected)
- Generic message if multiple issues found

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
