# Moderation Service Testing Guide

Complete guide for testing NSFW image moderation functionality.

---

## Prerequisites

1. ✅ **Moderation service running** on port 3003
2. ✅ **User service running** on port 3002
3. ✅ **Environment configured** (see README.md)

---

## Step 1: Start Moderation Service

```bash
cd apps/moderation-service
npm install
npm run start:dev
```

You should see: `🚀 Moderation service running on http://localhost:3003`

---

## Step 2: Test Moderation API Directly

### 2.1 Test Safe Image (Mock Provider)

```bash
curl -X POST http://localhost:3003/moderation/check-image \
  -H "Content-Type: application/json" \
  -d '{"imageUrl": "https://example.com/profile.jpg"}'
```

**Expected Response:**
```json
{
  "safe": true,
  "confidence": 0.95,
  "categories": {
    "adult": 0.1,
    "racy": 0.1
  }
}
```

---

### 2.2 Test Unsafe Image (Mock Provider)

Mock provider rejects URLs containing unsafe keywords: "nsfw", "explicit", "adult", "xxx"

```bash
curl -X POST http://localhost:3003/moderation/check-image \
  -H "Content-Type: application/json" \
  -d '{"imageUrl": "https://example.com/nsfw-image.jpg"}'
```

**Expected Response:**
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

---

### 2.3 Test Invalid URL

```bash
curl -X POST http://localhost:3003/moderation/check-image \
  -H "Content-Type: application/json" \
  -d '{"imageUrl": "not-a-valid-url"}'
```

**Expected Response:**
```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "errors": [
    {
      "path": "imageUrl",
      "message": "Invalid image URL"
    }
  ]
}
```

---

## Step 3: Test Integration with User Service

### 3.1 Test Profile Creation with Safe Image

```bash
# Get user ID and token from auth-service first
USER_ID="your_user_id"
ACCESS_TOKEN="your_access_token"

# Create profile with safe image URL
curl -X POST http://localhost:3002/users/$USER_ID/profile \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "dateOfBirth": "2000-01-01T00:00:00Z",
    "gender": "MALE",
    "displayPictureUrl": "https://example.com/safe-profile.jpg"
  }'
```

**Expected:** Profile created successfully (200 OK)

---

### 3.2 Test Profile Creation with Unsafe Image

```bash
curl -X POST http://localhost:3002/users/$USER_ID/profile \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser2",
    "dateOfBirth": "2000-01-01T00:00:00Z",
    "gender": "FEMALE",
    "displayPictureUrl": "https://example.com/nsfw-image.jpg"
  }'
```

**Expected Response (400 Bad Request):**
```json
{
  "statusCode": 400,
  "message": "Image failed moderation check. Please upload a safe for work image."
}
```

---

### 3.3 Test Adding Photo with Unsafe Image

```bash
curl -X POST http://localhost:3002/me/photos \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/explicit-photo.jpg",
    "order": 0
  }'
```

**Expected Response (400 Bad Request):**
```json
{
  "statusCode": 400,
  "message": "Image failed moderation check. Please upload a safe for work image."
}
```

---

## Step 4: Test with Real Moderation Provider

### 4.1 Setup Sightengine (Recommended)

1. Sign up at https://sightengine.com/
2. Get API key from dashboard
3. Update `.env`:
   ```env
   MODERATION_PROVIDER=sightengine
   MODERATION_API_URL=https://api.sightengine.com/1.0/check.json
   MODERATION_API_KEY=your_api_key_here
   ```
4. Restart moderation service

### 4.2 Test with Real Images

```bash
# Test with a safe image (public URL)
curl -X POST http://localhost:3003/moderation/check-image \
  -H "Content-Type: application/json" \
  -d '{"imageUrl": "https://picsum.photos/200/300"}'

# Test with potentially unsafe image
curl -X POST http://localhost:3003/moderation/check-image \
  -H "Content-Type: application/json" \
  -d '{"imageUrl": "https://example.com/test-image.jpg"}'
```

**Note:** Sightengine analyzes the actual image content, not just the URL.

---

## Step 5: Test Error Scenarios

### 5.1 Moderation Service Down

1. Stop moderation service
2. Try to create profile:

```bash
curl -X POST http://localhost:3002/users/$USER_ID/profile \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "dateOfBirth": "2000-01-01T00:00:00Z",
    "gender": "MALE",
    "displayPictureUrl": "https://example.com/image.jpg"
  }'
```

**Expected Response (503 Service Unavailable):**
```json
{
  "statusCode": 503,
  "message": "Unable to verify image content. Please try again later."
}
```

---

### 5.2 Invalid Image URL Format

```bash
curl -X POST http://localhost:3003/moderation/check-image \
  -H "Content-Type: application/json" \
  -d '{"imageUrl": "not-a-url"}'
```

**Expected:** Validation error

---

## Step 6: Complete Test Flow

```bash
#!/bin/bash

MODERATION_URL="http://localhost:3003"
USER_SERVICE_URL="http://localhost:3002"

echo "1. Testing moderation service directly..."

# Test safe image
echo "Testing safe image..."
curl -s -X POST $MODERATION_URL/moderation/check-image \
  -H "Content-Type: application/json" \
  -d '{"imageUrl": "https://example.com/safe.jpg"}' | jq

# Test unsafe image (mock provider)
echo -e "\nTesting unsafe image (mock)..."
curl -s -X POST $MODERATION_URL/moderation/check-image \
  -H "Content-Type: application/json" \
  -d '{"imageUrl": "https://example.com/nsfw-image.jpg"}' | jq

echo -e "\n2. Testing integration with user-service..."
echo "Note: Requires valid USER_ID and ACCESS_TOKEN"

# Get tokens from auth-service first, then:
# USER_ID="your_user_id"
# ACCESS_TOKEN="your_access_token"

# Create profile with safe image
# curl -X POST $USER_SERVICE_URL/users/$USER_ID/profile \
#   -H "Content-Type: application/json" \
#   -d '{
#     "username": "testuser",
#     "dateOfBirth": "2000-01-01T00:00:00Z",
#     "gender": "MALE",
#     "displayPictureUrl": "https://example.com/safe.jpg"
#   }' | jq

echo -e "\n✅ Testing complete!"
```

---

## Production Recommendations

1. **Use Sightengine or Google Vision API** - More accurate than mock provider
2. **Handle rate limits** - Implement retry logic for API calls
3. **Cache results** - Cache moderation results for same image URLs
4. **Async processing** - For better UX, validate async and notify user
5. **Fallback strategy** - If moderation service is down, decide on fail-open vs fail-closed
6. **Logging** - Log all moderation checks for audit trail
7. **Monitoring** - Monitor moderation service health and API quota usage

---

## Troubleshooting

### Moderation service not responding

- Check if service is running: `curl http://localhost:3003/moderation/check-image`
- Check logs for errors
- Verify environment variables are set correctly

### Always returning unsafe

- Check API key is valid (for real providers)
- Verify API quota hasn't been exceeded
- Check network connectivity to moderation API

### User service can't connect to moderation service

- Verify `MODERATION_SERVICE_URL` in user-service `.env` is correct
- Check both services are running
- Verify CORS settings if services are on different origins

