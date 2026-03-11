# Backblaze B2 Storage Configuration

## Overview
The files-service is now configured to use **Backblaze B2** S3-compatible storage for saving profile images and other files.

## Configuration Details

### Backblaze B2 Credentials
- **Access Key**: `005a3fb6fb4a9c20000000001`
- **Secret Key**: `K0050iWaI+iFasQTuOUAS4mwgom/XSM`
- **Endpoint**: `https://s3.us-east-005.backblazeb2.com`
- **Region**: `us-east-005`
- **Bucket Name**: `aiofhtheworlsgif`
- **Public URL**: `https://f005.backblazeb2.com/file/aiofhtheworlsgif`

### Environment Variables (.env)
```bash
# Backblaze B2 S3-Compatible Storage
R2_ACCESS_KEY_ID=005a3fb6fb4a9c20000000001
R2_SECRET_ACCESS_KEY=K0050iWaI+iFasQTuOUAS4mwgom/XSM
R2_ENDPOINT=https://s3.us-east-005.backblazeb2.com
R2_REGION=us-east-005
R2_BUCKET_NAME=aiofhtheworlsgif
R2_PUBLIC_URL=https://f005.backblazeb2.com/file/aiofhtheworlsgif
R2_ACCOUNT_ID=us-east-005

# File Upload Settings
FILE_UPLOAD_MAX_SIZE_MB=10
IMAGE_MAX_FILE_SIZE_MB=10
```

## How It Works

### 1. File Upload Flow
```
Frontend → POST /files/upload → Files Service (3008) → Backblaze B2
                                                      ↓
                                              Returns Public URL
```

### 2. Storage Structure
Files are organized in the bucket:
```
aiofhtheworlsgif/
  ├── profile-photos/
  │   └── user123/
  │       └── 1234567890-uuid-photo.jpg
  ├── uploads/
  │   └── user456/
  │       └── 1234567890-uuid-image.jpg
  └── ...
```

### 3. Public URL Format
After upload, files are accessible at:
```
https://f005.backblazeb2.com/file/aiofhtheworlsgif/{folder}/{userId}/{filename}
```

Example:
```
https://f005.backblazeb2.com/file/aiofhtheworlsgif/profile-photos/user123/1234567890-uuid-photo.jpg
```

## API Usage

### Upload Profile Photo
```javascript
const formData = new FormData();
formData.append('file', photoFile);
formData.append('folder', 'profile-photos');

const response = await fetch('http://localhost:3008/files/upload', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  },
  body: formData
});

const { file } = await response.json();
console.log('Uploaded URL:', file.url);
// URL: https://f005.backblazeb2.com/file/aiofhtheworlsgif/profile-photos/user123/...
```

### Use in Onboarding
```javascript
// 1. Upload photo
const uploadedUrl = await uploadToService(file);

// 2. Create profile with photo URL
const profileData = {
  username: name.trim(),
  dateOfBirth: dobDate.toISOString(),
  gender: backendGender,
  displayPictureUrl: uploadedUrl  // Backblaze B2 URL
};

await fetch(API.USERS.CREATE_PROFILE(userId), {
  method: 'POST',
  body: JSON.stringify(profileData)
});
```

## Features

### Image Processing
- ✅ Automatic resizing (max 2000x2000)
- ✅ Format optimization (JPEG/WebP)
- ✅ Quality compression (85% default)
- ✅ File size validation (max 10MB)

### Supported Formats
- JPEG/JPG
- PNG
- WebP
- GIF

### Security
- ✅ JWT authentication for user-associated files
- ✅ File type validation
- ✅ File size limits
- ✅ Ownership verification for deletions

## Testing

### 1. Test File Upload
```bash
curl -X POST http://localhost:3008/files/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@test-photo.jpg" \
  -F "folder=profile-photos"
```

### 2. Test from Frontend
1. Go to http://localhost:3000
2. Sign up / Login
3. Go to onboarding
4. Upload photos
5. Check browser network tab for upload response
6. Verify URL starts with: `https://f005.backblazeb2.com/file/aiofhtheworlsgif/`

### 3. Verify in Backblaze B2
1. Login to Backblaze B2 console
2. Navigate to bucket: `aiofhtheworlsgif`
3. Check uploaded files in folders: `profile-photos/`, `uploads/`

## Troubleshooting

### Upload Fails
**Error**: "Failed to upload file to R2"
**Solution**: 
- Check Backblaze B2 credentials are correct
- Verify bucket name is `aiofhtheworlsgif`
- Ensure bucket is public or has correct CORS settings

### Image Not Loading
**Error**: Image URL returns 404
**Solution**:
- Verify bucket is set to "Public" in Backblaze B2
- Check the public URL format matches: `https://f005.backblazeb2.com/file/aiofhtheworlsgif/...`
- Ensure file was actually uploaded (check Backblaze console)

### CORS Issues
If frontend can't upload directly:
1. Go to Backblaze B2 bucket settings
2. Add CORS rules:
```json
[
  {
    "corsRuleName": "downloadFromAnyOrigin",
    "allowedOrigins": ["*"],
    "allowedHeaders": ["*"],
    "allowedOperations": ["s3_get", "s3_head"],
    "maxAgeSeconds": 3600
  }
]
```

## Service Status
✅ Files Service running on port 3008
✅ Backblaze B2 configured and connected
✅ Bucket: aiofhtheworlsgif
✅ Ready to accept uploads!

## Next Steps
1. ✅ Files service configured with Backblaze B2
2. ✅ Frontend API configuration updated
3. ✅ Upload endpoints ready
4. 🔄 Test complete upload flow from frontend
5. 🔄 Verify images display correctly in profile/facecard
