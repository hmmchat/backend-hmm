# User Service

User profile management service for HMM backend. Handles all user profile data, preferences, photos, and related information.

## Overview

This service manages user profiles after authentication. Users authenticate via `auth-service`, then create and manage their profiles here.

## Features

- User profile creation and management
- Photo management (up to 4 photos + display picture)
- Music preferences (song + artist)
- Brand preferences (4-5 brands)
- Interests (max 4)
- Values (max 4)
- Location tracking for discovery
- User status management
- Profile completion tracking

## Tech Stack

- **Framework**: NestJS with Fastify
- **Database**: PostgreSQL with Prisma ORM
- **Validation**: Zod
- **Authentication**: JWT token verification (uses same keys as auth-service)

## Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Set up environment variables** (`.env`):
   ```env
   DATABASE_URL="postgresql://user:password@localhost:5432/user_service_db"
   JWT_PUBLIC_JWK='{"kty":"EC",...}' # Same as auth-service
   PORT=3002
   ALLOWED_ORIGINS="http://localhost:3000,http://localhost:5173"
   ```

3. **Generate Prisma Client**:
   ```bash
   npm run prisma:generate
   ```

4. **Run migrations**:
   ```bash
   npm run prisma:migrate
   ```

5. **Start development server**:
   ```bash
   npm run start:dev
   ```

## API Endpoints

### Profile Management

- `POST /users/:userId/profile` - Create user profile (called after auth signup)
- `GET /users/:userId` - Get user profile by ID
- `GET /me` - Get current user profile (requires Bearer token)
- `PATCH /me/profile` - Update profile (username, gender, intent, music, video)

### Photos

- `GET /me/photos` - Get user's photos
- `GET /users/:userId/photos` - Get user's photos by ID
- `POST /me/photos` - Add photo (max 4)
- `DELETE /me/photos/:photoId` - Delete photo

### Preferences

- `PATCH /me/brand-preferences` - Update brand preferences (max 5)
- `PATCH /me/interests` - Update interests (max 4)
- `PATCH /me/values` - Update values (max 4)
- `PATCH /me/music-preference` - Update music preference

### Location & Status

- `PATCH /me/location` - Update user location (lat/lng)
- `PATCH /me/status` - Update user status

### Batch Operations

- `POST /users/batch` - Get multiple users by IDs
- `GET /users/nearby?latitude=...&longitude=...&radius=...&limit=...` - Get users nearby

### Music Catalog

- `POST /music/preferences` - Create or get music preference (song + artist)

## Business Rules

### Profile Creation

1. **Required Fields**: username, dateOfBirth, gender, displayPictureUrl
2. **Username**: Must be unique, 3-30 characters, alphanumeric + underscore
3. **Date of Birth**: Must be at least 18 years old
4. **Display Picture**: Must pass NSFW validation (TODO: integrate with moderation-service)
5. **Profile Completion**: Set to `true` when all required fields are provided

### Gender Rules

- Can change **once** from `PREFER_NOT_TO_SAY` to any other value
- Cannot change from any other value
- Tracked via `genderChanged` flag

### Immutable Fields

- `dateOfBirth` - Cannot be changed once set

### Limits

- **Photos**: Maximum 4 additional photos (excluding display picture)
- **Brands**: Maximum 5 brands
- **Interests**: Maximum 4 interests
- **Values**: Maximum 4 values
- **Intent**: Maximum 50 characters

### Profile Completion Flow

- If user quits before completing profile: User ID exists in auth-service, but profile incomplete
- On next login: Frontend checks `profileCompleted` flag and redirects to profile creation

## Data Model

See `prisma/schema.prisma` for complete schema. Key models:

- **User**: Main user profile
- **UserPhoto**: Additional photos (max 4)
- **Song**: Music catalog
- **Brand**: Brand catalog
- **Interest**: Interest catalog
- **Value**: Value catalog
- **UserBrand**, **UserInterest**, **UserValue**: Junction tables

## Authentication

All authenticated endpoints require:
```
Authorization: Bearer <accessToken>
```

The service verifies tokens using the same JWT public key as auth-service.

## User ID Consistency

**Critical**: User IDs in user-service must match user IDs from auth-service. The profile creation endpoint accepts a `userId` parameter that should be the same ID returned from auth-service signup.

## Integration with Other Services

### Auth Service
- User authenticates → Gets userId
- Frontend calls `POST /users/:userId/profile` to create profile

### Files Service (TODO)
- Photo uploads should go through files-service
- Store URLs in user-service

### Moderation Service (TODO)
- NSFW validation for display picture and photos
- Integrate before accepting photo URLs

### Discovery Service
- Can query user-service for user profiles
- Use `/users/nearby` for location-based discovery
- Use `/users/batch` for bulk user data

## Development

```bash
# Watch mode
npm run start:dev

# Build
npm run build

# Start production
npm start

# Prisma
npm run prisma:generate  # Generate client
npm run prisma:migrate   # Create migration
npm run prisma:push      # Push schema (dev only)
```

## Testing

Example profile creation:

```bash
curl -X POST http://localhost:3002/users/test-user-id/profile \
  -H "Content-Type: application/json" \
  -d '{
    "username": "johndoe",
    "dateOfBirth": "2000-01-01T00:00:00Z",
    "gender": "MALE",
    "displayPictureUrl": "https://example.com/photo.jpg"
  }'
```

Example get profile:

```bash
curl http://localhost:3002/users/test-user-id \
  -H "Authorization: Bearer <token>"
```

## Migration

See `MIGRATION.md` for details on migrating from auth-service.
