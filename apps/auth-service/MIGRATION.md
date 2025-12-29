# Auth Service Migration Guide

This guide explains the changes made to auth-service to separate user profile data.

## Changes Made

### Removed from Auth Service

1. **User Model Fields Removed**:
   - `name` - Moved to user-service as `username`
   - `photoUrl` - Moved to user-service as `displayPictureUrl`

2. **Preference Model Removed**:
   - `Preference` table entirely removed
   - `videoEnabled`, `meetMode`, `latitude`, `longitude` moved to user-service

3. **Endpoints Removed**:
   - `GET /me` - Moved to user-service
   - `PATCH /me/preferences` - Moved to user-service

4. **Methods Removed from AuthService**:
   - `getMe()` - Use user-service instead
   - `updatePreferences()` - Use user-service instead

### What Remains in Auth Service

- User authentication (login/signup with Google, Apple, Facebook, Phone)
- Session management (refresh tokens)
- User model with minimal fields:
  - `id` (primary key, same as user-service)
  - `email`, `phone`
  - `googleSub`, `appleSub`, `facebookId`
  - `acceptedTerms`, `acceptedTermsAt`, `acceptedTermsVer`

## Database Migration

You need to create a Prisma migration to remove the fields from the database:

### Step 1: Update Prisma Schema

Update `apps/auth-service/prisma/schema.prisma`:

```prisma
model User {
  id                 String   @id @default(cuid())
  email              String?  @unique
  phone              String?  @unique
  googleSub          String?  @unique
  appleSub           String?  @unique
  facebookId         String?  @unique
  acceptedTerms      Boolean  @default(false)
  acceptedTermsAt    DateTime?
  acceptedTermsVer   String?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  
  sessions           Session[]
  
  @@map("users")
}

model Session {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  refreshHash String
  expiresAt   DateTime
  createdAt   DateTime @default(now())
  
  @@index([userId])
  @@map("sessions")
}
```

### Step 2: Create Migration

```bash
cd apps/auth-service
npm run prisma:migrate dev --name remove_user_profile_fields
```

**⚠️ WARNING**: This will delete data! Make sure to:
1. Export existing `name` and `photoUrl` data if needed
2. Migrate that data to user-service first
3. Then run the migration

### Step 3: Alternative - Manual Migration

If you want to keep existing data temporarily:

```sql
-- Don't drop columns yet, just stop using them
-- The columns can be dropped later after confirming user-service migration
ALTER TABLE users DROP COLUMN IF EXISTS name;
ALTER TABLE users DROP COLUMN IF EXISTS "photoUrl";

-- Drop Preference table
DROP TABLE IF EXISTS preferences;
```

### Step 4: Generate Prisma Client

```bash
npm run prisma:generate
```

## Updated Flow

### Old Flow (Before Migration)
1. User signs up → auth-service creates User with name, photoUrl
2. User calls `GET /me` → Returns user data from auth-service
3. User updates preferences → `PATCH /me/preferences` in auth-service

### New Flow (After Migration)
1. User signs up → auth-service creates minimal User (id, email/phone, provider IDs)
2. Frontend redirects to profile creation
3. User creates profile → `POST /users/{userId}/profile` in user-service
4. User calls `GET /me` → Returns user data from user-service
5. User updates preferences → `PATCH /me/location`, etc. in user-service

## Code Changes

### AuthService Changes

- Removed `name` and `photoUrl` from `signInOrUp()` method
- Provider methods (Google, Apple, Facebook) no longer pass name/photoUrl to signInOrUp
- Removed `getMe()` and `updatePreferences()` methods

### Controller Changes

- `MeController` removed entirely
- `MetricsController` created separately for metrics endpoint (`GET /metrics/meetings`)

## Testing

After migration, test that:
1. Signup still works and creates user in auth-service
2. User can create profile in user-service with the same userId
3. Token verification works in user-service

## Rollback Plan

If you need to rollback:
1. Restore `name` and `photoUrl` columns in User table
2. Restore Preference table
3. Revert code changes in auth-service
4. Update user-service to not require profile creation

## Notes

- User IDs remain the same between services - this is critical!
- Frontend must be updated to call user-service for profile operations
- Existing users without profiles will need to complete profile creation on next login

