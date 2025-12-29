# User Service Migration Guide

This guide explains how to set up the user-service and migrate user data from auth-service.

## Prerequisites

1. PostgreSQL database for user-service (can be same or different from auth-service)
2. Node.js v22+ installed
3. Prisma CLI installed globally or via npm

## Setup Steps

### 1. Database Setup

Create a new database for user-service (or use existing):

```bash
# Using psql
createdb user_service_db

# Or specify connection string in .env
DATABASE_URL="postgresql://user:password@localhost:5432/user_service_db"
```

### 2. Install Dependencies

```bash
cd apps/user-service
npm install
```

### 3. Generate Prisma Client

```bash
npm run prisma:generate
```

### 4. Run Database Migration

```bash
# For development (creates migration and applies it)
npm run prisma:migrate

# Or push schema directly (development only, not for production)
npm run prisma:push
```

### 5. Seed Initial Data (Optional)

You may want to seed initial data for:
- Brands (e.g., JBL, Apple, Nike, BMW)
- Interests (e.g., Music, Sports, Travel)
- Values (e.g., Honesty, Adventure, Family)

Create a seed script in `prisma/seed.ts`:

```typescript
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Seed brands
  await prisma.brand.createMany({
    data: [
      { name: "JBL" },
      { name: "Apple" },
      { name: "Nike" },
      { name: "BMW" },
      // Add more brands...
    ],
    skipDuplicates: true
  });

  // Seed interests
  await prisma.interest.createMany({
    data: [
      { name: "Music" },
      { name: "Sports" },
      { name: "Travel" },
      // Add more interests...
    ],
    skipDuplicates: true
  });

  // Seed values
  await prisma.value.createMany({
    data: [
      { name: "Honesty" },
      { name: "Adventure" },
      { name: "Family" },
      // Add more values...
    ],
    skipDuplicates: true
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

Run seed:
```bash
npx tsx prisma/seed.ts
```

## Migration from Auth-Service

### Option 1: Fresh Start (Recommended for new deployments)

If you're starting fresh, no migration needed. User profiles will be created in user-service when users complete profile creation after signup.

### Option 2: Migrate Existing Data

If you have existing users in auth-service, you'll need to:

1. **Export user data from auth-service**:
   - Export users with `name`, `photoUrl` if they exist
   - Note: `name` maps to `username` in user-service
   - `photoUrl` maps to `displayPictureUrl`

2. **Create migration script** to import:
   ```typescript
   // scripts/migrate-users.ts
   import { PrismaClient as AuthPrisma } from "../../auth-service/node_modules/.prisma/client";
   import { PrismaClient as UserPrisma } from "../node_modules/.prisma/client";
   
   const authPrisma = new AuthPrisma();
   const userPrisma = new UserPrisma();
   
   async function migrate() {
     const authUsers = await authPrisma.user.findMany({
       where: {
         name: { not: null },
         photoUrl: { not: null }
       }
     });
   
     for (const authUser of authUsers) {
       // Create user profile in user-service
       // Note: username might need sanitization
       await userPrisma.user.upsert({
         where: { id: authUser.id },
         create: {
           id: authUser.id,
           username: authUser.name, // Map name to username
           displayPictureUrl: authUser.photoUrl,
           profileCompleted: true,
           // Note: DOB and gender won't be available from auth-service
         },
         update: {}
       });
     }
   }
   ```

3. **Update auth-service schema** to remove `name` and `photoUrl`:
   - Create a migration in auth-service to drop these columns
   - Remove `Preference` model if it exists

## Environment Variables

Add to `apps/user-service/.env`:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/user_service_db"
JWT_PUBLIC_JWK='{"kty":"EC",...}' # Same as auth-service for token verification
PORT=3002
ALLOWED_ORIGINS="http://localhost:3000,http://localhost:5173"
```

## Running the Service

```bash
# Development
npm run start:dev

# Production
npm run build
npm start
```

## API Endpoints

See the user controller for all available endpoints:
- `POST /users/:userId/profile` - Create user profile
- `GET /users/:userId` - Get user profile
- `GET /me` - Get current user profile
- `PATCH /me/profile` - Update profile
- `GET /me/photos` - Get user photos
- `POST /me/photos` - Add photo
- `DELETE /me/photos/:photoId` - Delete photo
- `PATCH /me/location` - Update location
- `PATCH /me/status` - Update user status
- And more...

## Testing

After setup, test the service:

1. **Create a profile**:
   ```bash
   curl -X POST http://localhost:3002/users/{userId}/profile \
     -H "Content-Type: application/json" \
     -d '{
       "username": "testuser",
       "dateOfBirth": "2000-01-01T00:00:00Z",
       "gender": "MALE",
       "displayPictureUrl": "https://example.com/photo.jpg"
     }'
   ```

2. **Get profile**:
   ```bash
   curl http://localhost:3002/users/{userId}
   ```

## Notes

- User IDs in user-service must match user IDs from auth-service
- Profile creation is separate from authentication - users sign up in auth-service, then create profile in user-service
- NSFW validation for photos should be integrated with moderation-service (TODO in code)

