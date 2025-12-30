# Testing Checklist for User Service & Moderation Service

Quick checklist for testing both services tomorrow.

---

## ✅ Pre-Testing Setup

### 1. User Service
- [ ] Environment variables configured (`.env` in `apps/user-service/`)
  - `DATABASE_URL` - PostgreSQL connection
  - `JWT_PUBLIC_JWK` - JWT public key (same as auth-service)
  - `PORT=3002`
  - `MODERATION_SERVICE_URL=http://localhost:3003`
- [ ] Database created and migrated
  ```bash
  cd apps/user-service
  npm run prisma:migrate
  ```
- [ ] Seed data loaded (brands, interests, values)
  ```bash
  npm run seed
  ```
- [ ] Dependencies installed
  ```bash
  npm install
  ```

### 2. Moderation Service
- [ ] Environment variables configured (`.env` in `apps/moderation-service/`)
  - `PORT=3003`
  - `MODERATION_PROVIDER=mock` (for testing)
  - `ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173`
- [ ] Dependencies installed
  ```bash
  cd apps/moderation-service
  npm install
  ```

### 3. Supporting Services
- [ ] **Auth Service** running (port 3001) - Needed to get user tokens
- [ ] **PostgreSQL** running - Database for user-service
- [ ] **Redis** running (if using) - Optional

---

## 🚀 Quick Start Commands

### Start Services (in separate terminals):

**Terminal 1 - Moderation Service:**
```bash
cd apps/moderation-service
npm run start:dev
```
Expected: `🚀 Moderation service running on http://localhost:3003`

**Terminal 2 - User Service:**
```bash
cd apps/user-service
npm run start:dev
```
Expected: `🚀 User service running on http://localhost:3002`

**Terminal 3 - Auth Service (if not already running):**
```bash
cd apps/auth-service
npm run start:dev
```
Expected: `🚀 Auth service running on http://localhost:3001`

---

## 📋 Testing Order

### Step 1: Test Moderation Service Standalone
- [ ] Test safe image check
- [ ] Test unsafe image check (mock provider uses keywords)
- [ ] Test invalid URL validation

See: `apps/moderation-service/TESTING.md`

### Step 2: Test User Service Profile Creation
- [ ] Create profile with safe image (should succeed)
- [ ] Create profile with unsafe image (should fail with 400)
- [ ] Verify moderation service is called

### Step 3: Test User Service Photo Management
- [ ] Add photo with safe image (should succeed)
- [ ] Add photo with unsafe image (should fail with 400)
- [ ] Test max 4 photos limit

### Step 4: Test Integration Flow
- [ ] Complete profile creation → moderation check → acceptance
- [ ] Complete profile creation → moderation check → rejection
- [ ] Verify error messages are clear

---

## 🧪 Quick Test Scripts

### Test Moderation Service:
```bash
# Safe image
curl -X POST http://localhost:3003/moderation/check-image \
  -H "Content-Type: application/json" \
  -d '{"imageUrl": "https://example.com/safe.jpg"}'

# Unsafe image (mock provider rejects URLs with "nsfw", "explicit", "adult", "xxx")
curl -X POST http://localhost:3003/moderation/check-image \
  -H "Content-Type: application/json" \
  -d '{"imageUrl": "https://example.com/nsfw-image.jpg"}'
```

### Test User Service Integration:
```bash
# Get token from auth-service first, then:
USER_ID="your_user_id"
ACCESS_TOKEN="your_access_token"

# Create profile with unsafe image (should fail)
curl -X POST http://localhost:3002/users/$USER_ID/profile \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "dateOfBirth": "2000-01-01T00:00:00Z",
    "gender": "MALE",
    "displayPictureUrl": "https://example.com/nsfw-image.jpg"
  }'
```

---

## 📚 Documentation References

- **User Service Testing**: `apps/user-service/TESTING.md`
- **Moderation Service Testing**: `apps/moderation-service/TESTING.md`
- **Moderation Service Setup**: `apps/moderation-service/README.md`
- **User Service Setup**: `apps/user-service/README.md`

---

## ⚠️ Common Issues & Solutions

### Issue: Moderation service not responding
- **Check:** Is moderation service running on port 3003?
- **Solution:** Start moderation service first

### Issue: User service can't connect to moderation service
- **Check:** `MODERATION_SERVICE_URL` in user-service `.env`
- **Solution:** Should be `http://localhost:3003`

### Issue: Database connection error
- **Check:** PostgreSQL running and `DATABASE_URL` correct
- **Solution:** Verify database exists and connection string

### Issue: Token validation errors
- **Check:** `JWT_PUBLIC_JWK` matches auth-service
- **Solution:** Use same JWT key in both services

---

## ✅ Success Criteria

After testing, you should be able to:

1. ✅ Moderation service accepts/rejects images based on content
2. ✅ User service rejects profile creation with unsafe images
3. ✅ User service rejects photo uploads with unsafe images
4. ✅ Error messages are clear and helpful
5. ✅ Safe images are accepted successfully
6. ✅ Both services handle errors gracefully

---

## 🎯 Next Steps After Testing

1. Test with real moderation provider (Sightengine/Google Vision) if needed
2. Adjust moderation thresholds if needed
3. Add monitoring/logging for moderation checks
4. Consider async moderation processing for better UX
5. Add caching for repeated image checks

---

Good luck with testing tomorrow! 🚀

