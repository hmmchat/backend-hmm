# HMM Testing & Integration Guide

This guide provides ways to quickly set up test data (friends, messages, conversations) without needing manual UI interaction or valid JWTs for every action.

## 1. Quick Friend Setup Script

We've created a script at `scripts/test-friend-setup.ts` to link two users instantly.

### Prerequisite: Find User IDs
You can find a user's ID by searching by email in the `hmm_auth` database:
```bash
psql "postgresql://kshitizmaurya@localhost:5432/hmm_auth" -c "SELECT id, email FROM \"User\" WHERE email = 'user@email.com';"
```

### Run the Script
```bash
# Usage: npx tsx scripts/test-friend-setup.ts <senderId> <receiverId> "Your Message"
npx tsx scripts/test-friend-setup.ts cmlj3fquw00001k2ep0j8mz8m cmlj7tl8i000d1k2e3tuz4ift "Hey, let's chat!"
```

## 2. Useful API Endpoints (Bypassing Auth)

The `friend-service` (port 3009) has special `/test/` and `/internal/` endpoints for development.

### Create Friendship (Internal)
Allows making two users friends directly.
- **POST** `http://localhost:3009/internal/friends/auto-create`
- **Headers**: `x-service-token: development`
- **Body**: `{ "userId1": "...", "userId2": "..." }`

### Send Message without Token
- **POST** `http://localhost:3009/test/friends/:friendId/messages?fromUserId=SENDER_ID`
- **Body**: `{ "message": "Hello world" }`

### Fetch Inbox for any User
- **GET** `http://localhost:3009/test/conversations/inbox?userId=USER_ID`

## 3. Database Quick Fix (PSQL)

If you need to manually force a conversation state, use these commands on `hmm_friend`:

```sql
-- Make them friends
INSERT INTO friends (id, "userId1", "userId2", "createdAt") 
VALUES (gen_random_uuid(), 'ID_1', 'ID_2', NOW()) 
ON CONFLICT DO NOTHING;

-- Force a conversation into the Inbox
INSERT INTO conversations (id, "userId1", "userId2", section, "lastMessageAt")
VALUES (gen_random_uuid(), 'ID_1', 'ID_2', 'INBOX', NOW())
ON CONFLICT ("userId1", "userId2") DO UPDATE SET section = 'INBOX';
```
