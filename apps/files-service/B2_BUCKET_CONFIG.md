# Backblaze B2 Bucket Configuration Checklist

## Critical Settings for Image Display

### 1. Bucket Must Be Public
**Location:** Backblaze B2 Console → Buckets → aiofhtheworlsgif → Bucket Settings

**Required Setting:**
- ✅ **Bucket Type:** Public
- ❌ **NOT** Private

**Why:** If bucket is private, images won't load in browser (403 Forbidden)

### 2. CORS Configuration
**Location:** Backblaze B2 Console → Buckets → aiofhtheworlsgif → Bucket Settings → CORS Rules

**Required CORS Rules:**
```json
[
  {
    "corsRuleName": "allowWebAccess",
    "allowedOrigins": [
      "http://localhost:3000",
      "http://localhost:3001",
      "https://hmmchat.live",
      "https://app.hmmchat.live"
    ],
    "allowedHeaders": ["*"],
    "allowedOperations": [
      "s3_get",
      "s3_head"
    ],
    "maxAgeSeconds": 3600
  }
]
```

**Why:** Prevents CORS errors when loading images from different origin

### 3. Verify Public URL Format
**Correct Format:**
```
https://f005.backblazeb2.com/file/aiofhtheworlsgif/{path}/{filename}
```

**Example:**
```
https://f005.backblazeb2.com/file/aiofhtheworlsgif/profile-photos/user123/1234567890-uuid-photo.jpg
```

**NOT:**
```
https://s3.us-east-005.backblazeb2.com/aiofhtheworlsgif/...  ❌ (S3 endpoint, not public)
```

### 4. Test Bucket Access
**Quick Test:**
1. Upload a test image via files-service
2. Copy the returned URL
3. Open URL directly in browser
4. Image should display (not download or show error)

**Test URL:**
```bash
# Should return 200 OK and display image
curl -I https://f005.backblazeb2.com/file/aiofhtheworlsgif/profile-photos/test.jpg
```

### 5. File Permissions
**Each uploaded file should have:**
- ✅ Public read access
- ✅ Correct Content-Type (image/jpeg, image/png, etc.)

**Files service automatically sets:**
```javascript
{
  ContentType: contentType,  // e.g., "image/jpeg"
  // Public read is inherited from bucket settings
}
```

## Common Issues

### Issue: Images Return 403 Forbidden
**Cause:** Bucket is set to Private

**Fix:**
1. Go to Backblaze B2 Console
2. Select bucket `aiofhtheworlsgif`
3. Change Bucket Type to **Public**
4. Save changes

### Issue: CORS Error in Browser Console
**Error Message:**
```
Access to image at 'https://f005.backblazeb2.com/...' from origin 'http://localhost:3000' 
has been blocked by CORS policy
```

**Fix:**
1. Add CORS rules (see above)
2. Make sure `http://localhost:3000` is in allowedOrigins
3. Save and wait 1-2 minutes for changes to propagate

### Issue: Images Download Instead of Display
**Cause:** Wrong Content-Type or bucket settings

**Fix:**
1. Check Content-Type is set correctly (image/jpeg, image/png)
2. Verify bucket is Public
3. Check file metadata in Backblaze console

## Verification Steps

### Step 1: Check Bucket Settings
```bash
# Login to Backblaze B2 Console
https://secure.backblaze.com/b2_buckets.htm

# Verify:
- Bucket Name: aiofhtheworlsgif
- Bucket Type: Public ✅
- Region: us-east-005
```

### Step 2: Test Direct Access
```bash
# Upload a test file
curl -X POST http://localhost:3008/files/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@test.jpg" \
  -F "folder=test"

# Copy the returned URL and open in browser
# Should display image, not download
```

### Step 3: Check CORS
```bash
# Test CORS headers
curl -I -H "Origin: http://localhost:3000" \
  https://f005.backblazeb2.com/file/aiofhtheworlsgif/test/test.jpg

# Should include:
# Access-Control-Allow-Origin: http://localhost:3000
```

## Current Configuration

### Environment Variables (.env)
```bash
R2_ACCESS_KEY_ID=005a3fb6fb4a9c20000000001
R2_SECRET_ACCESS_KEY=K0050iWaI+iFasQTuOUAS4mwgom/XSM
R2_ENDPOINT=https://s3.us-east-005.backblazeb2.com
R2_REGION=us-east-005
R2_BUCKET_NAME=aiofhtheworlsgif
R2_PUBLIC_URL=https://f005.backblazeb2.com/file/aiofhtheworlsgif
```

### Upload Endpoint
```
POST http://localhost:3008/files/upload
```

### Expected Response
```json
{
  "success": true,
  "file": {
    "id": "clx123...",
    "url": "https://f005.backblazeb2.com/file/aiofhtheworlsgif/profile-photos/user123/1234567890-uuid-photo.jpg",
    "key": "profile-photos/user123/1234567890-uuid-photo.jpg",
    "mimeType": "image/jpeg",
    "size": 245678,
    "width": 1920,
    "height": 1080
  }
}
```

## Quick Fix Commands

### If images not loading:

1. **Check bucket is public:**
   - Login to Backblaze B2
   - Buckets → aiofhtheworlsgif
   - Settings → Bucket Type → Public

2. **Add CORS rules:**
   - Buckets → aiofhtheworlsgif
   - Settings → CORS Rules
   - Add the JSON rules above

3. **Test upload:**
   ```bash
   # From frontend console
   const formData = new FormData();
   formData.append('file', fileInput.files[0]);
   const res = await fetch('http://localhost:3008/files/upload', {
     method: 'POST',
     headers: {'Authorization': `Bearer ${localStorage.getItem('accessToken')}`},
     body: formData
   });
   console.log(await res.json());
   ```

4. **Verify URL works:**
   - Copy URL from response
   - Open in new browser tab
   - Should display image

## Status Check

✅ **Everything Working If:**
- Bucket is Public
- CORS rules configured
- Images load in browser
- No 403/CORS errors
- Upload returns Backblaze URLs
- URLs open directly in browser

❌ **Needs Fixing If:**
- Bucket is Private
- No CORS rules
- Images show 403 Forbidden
- CORS errors in console
- Images download instead of display
