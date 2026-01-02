# Discovery Service Test Setup Guide

## Quick Setup

1. **Apply Database Migrations:**
   ```bash
   cd apps/discovery-service
   npm run prisma:deploy
   ```

2. **Seed Test Data:**
   ```bash
   npm run prisma:seed
   ```

3. **Create Test Tokens:**
   Create `tests/discovery-service/.test-tokens` file with tokens for different user genders:
   ```bash
   export TOKEN_MALE="your_male_user_token"
   export TOKEN_FEMALE="your_female_user_token"
   export TOKEN_NON_BINARY="your_non_binary_user_token"
   export TOKEN_PREFER_NOT_TO_SAY="your_prefer_not_to_say_user_token"
   ```

4. **Run Tests:**
   ```bash
   cd tests/discovery-service
   ./test-discovery-service.sh
   ```

## Creating Test Users

To create test users with different genders:

1. **Get Google ID Token** (see `tests/auth-service/HOW_TO_GET_TOKENS.md`)

2. **Create Users via Auth Service:**
   ```bash
   # Create MALE user
   curl -X POST http://localhost:3001/auth/google \
     -H "Content-Type: application/json" \
     -d '{
       "idToken": "YOUR_GOOGLE_ID_TOKEN",
       "acceptedTerms": true,
       "acceptedTermsVer": "v1.0"
     }' | jq -r '.accessToken' > /tmp/token_male.txt
   
   # Then create profile with MALE gender via user-service
   # (Get user ID from token payload or auth response)
   ```

3. **Update User Gender via User Service:**
   ```bash
   # Update profile with specific gender
   curl -X PATCH http://localhost:3002/me/profile \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"gender": "MALE"}'
   ```

## Database Migration Issues

If migration fails due to existing enum:
```bash
# Reset migration state (development only)
cd apps/discovery-service
npm run prisma:push  # This will sync schema without migrations
```

## Troubleshooting

### Migration Fails
- Check if Gender enum already exists in database
- Use `prisma:push` for development instead of `prisma:deploy`

### Seed Fails
- Ensure migrations are applied first
- Check DATABASE_URL is set correctly
- Verify Prisma client is generated: `npm run prisma:generate`

### Tests Fail
- Verify all services are running (user-service, wallet-service, discovery-service)
- Check test tokens are valid
- Ensure users exist with correct genders

