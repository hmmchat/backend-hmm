# Files Service

File upload and storage service for hmmchat.live. Handles file uploads, image processing, and Cloudflare R2 storage integration.

## Features

- **File Upload**: Multipart file upload with validation
- **Image Processing**: Automatic resizing, optimization, and format conversion
- **Cloudflare R2 Storage**: S3-compatible object storage
- **Presigned URLs**: Direct client-to-R2 uploads
- **File Management**: Get, list, and delete files
- **User Association**: Files can be associated with users

## Setup

### Prerequisites

- Node.js v22+
- PostgreSQL database
- Cloudflare R2 account and bucket

### Installation

```bash
cd apps/files-service
npm install
```

### Environment Variables

Create a `.env` file:

```env
# Server
PORT=3008
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173

# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/files-service?schema=public

# Cloudflare R2 Configuration
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key_id
R2_SECRET_ACCESS_KEY=your_secret_access_key
R2_BUCKET_NAME=your_bucket_name
R2_PUBLIC_URL=https://your-bucket.r2.dev  # Or your custom domain

# JWT Authentication (for user verification)
JWT_PUBLIC_JWK='{"kty":"RSA",...}'
```

### Database Setup

```bash
# Generate Prisma client
npm run prisma:generate

# Run migrations
npm run prisma:migrate

# Or push schema (development)
npm run prisma:push
```

## API Endpoints

### Upload File

**POST** `/files/upload`

Upload a file with multipart/form-data.

**Headers:**
- `Authorization: Bearer {token}` (optional, for user association)

**Query Parameters:**
- `userId` (optional): User ID to associate file with
- `folder` (optional): Folder path in R2 (e.g., "profile-photos", "user-photos")
- `processImage` (optional): Process/optimize images (default: true)
- `maxWidth` (optional): Maximum image width (default: 2000)
- `maxHeight` (optional): Maximum image height (default: 2000)
- `quality` (optional): Image quality 1-100 (default: 85)

**Request:**
```bash
curl -X POST http://localhost:3008/files/upload \
  -H "Authorization: Bearer {token}" \
  -F "file=@photo.jpg" \
  -F "folder=profile-photos" \
  -F "processImage=true"
```

**Response:**
```json
{
  "success": true,
  "file": {
    "id": "clx123...",
    "url": "https://r2.hmmchat.live/uploads/user123/1234567890-uuid-photo.jpg",
    "key": "uploads/user123/1234567890-uuid-photo.jpg",
    "mimeType": "image/jpeg",
    "size": 245678,
    "width": 1920,
    "height": 1080,
    "metadata": {
      "originalFilename": "photo.jpg",
      "processed": true
    },
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

### Get File Info

**GET** `/files/:fileId`

Get file information.

**Response:**
```json
{
  "file": {
    "id": "clx123...",
    "url": "https://r2.hmmchat.live/uploads/user123/photo.jpg",
    "key": "uploads/user123/photo.jpg",
    "mimeType": "image/jpeg",
    "size": 245678,
    "width": 1920,
    "height": 1080,
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

### Delete File

**DELETE** `/files/:fileId`

Delete a file (requires authentication if file is user-associated).

**Headers:**
- `Authorization: Bearer {token}` (required if file has userId)

**Response:**
```json
{
  "success": true
}
```

### Generate Presigned URL

**POST** `/files/presigned-url`

Generate a presigned URL for direct client-to-R2 upload.

**Headers:**
- `Authorization: Bearer {token}` (required)

**Request:**
```json
{
  "filename": "photo.jpg",
  "mimeType": "image/jpeg",
  "folder": "profile-photos",
  "expiresIn": 3600
}
```

**Response:**
```json
{
  "success": true,
  "uploadUrl": "https://r2.cloudflarestorage.com/...",
  "fileId": "clx123...",
  "key": "uploads/user123/photo.jpg",
  "url": "https://r2.hmmchat.live/uploads/user123/photo.jpg"
}
```

### Get User Files

**GET** `/me/files?limit=50`

Get all files for the authenticated user.

**Headers:**
- `Authorization: Bearer {token}` (required)

**Response:**
```json
{
  "files": [
    {
      "id": "clx123...",
      "url": "https://r2.hmmchat.live/uploads/user123/photo.jpg",
      "mimeType": "image/jpeg",
      "size": 245678,
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

## Integration with User Service

The files-service can be used by the user-service for profile photos:

### Option 1: Frontend uploads directly to files-service

```javascript
// 1. Upload photo to files-service
const formData = new FormData();
formData.append('file', photoFile);

const uploadResponse = await fetch('http://localhost:3008/files/upload', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  },
  body: formData
});

const { file } = await uploadResponse.json();

// 2. Use the URL in user-service
await fetch('http://localhost:3002/users/:userId/profile', {
  method: 'POST',
  body: JSON.stringify({
    displayPictureUrl: file.url
  })
});
```

### Option 2: User-service calls files-service (future enhancement)

This would require adding a files-client service in user-service.

## Image Processing

Images are automatically:
- Validated (type, size)
- Resized if larger than max dimensions
- Optimized (compressed)
- Converted to JPEG/WebP format

**Supported formats:**
- JPEG/JPG
- PNG
- WebP
- GIF

**Limits:**
- Max file size: 10MB
- Max dimensions: 2000x2000 (configurable)
- Default quality: 85%

## File Organization

Files are organized in R2 by folder and user:

```
uploads/
  user123/
    1234567890-uuid-photo.jpg
profile-photos/
  user123/
    1234567890-uuid-dp.jpg
```

## Running

### Development

```bash
npm run start:dev
```

### Production

```bash
npm run build
npm start
```

## Testing

Test endpoints (no auth required):

```bash
# Upload test file
curl -X POST http://localhost:3008/test/files/upload \
  -F "file=@test.jpg" \
  -F "userId=test-user"

# Delete test file
curl -X DELETE http://localhost:3008/test/files/:fileId
```

## Architecture

- **NestJS + Fastify**: HTTP server with multipart support
- **Prisma**: Database ORM
- **Cloudflare R2**: Object storage (S3-compatible)
- **Sharp**: Image processing
- **AWS SDK**: R2 client (S3-compatible API)

## Security

- File type validation
- File size limits
- User authentication for user-associated files
- Ownership verification for deletions
- Image validation (prevents malicious files)
