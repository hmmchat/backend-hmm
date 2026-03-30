-- Initial schema for friend-service (Postgres)

-- Enums
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FriendRequestStatus') THEN
    CREATE TYPE "FriendRequestStatus" AS ENUM ('PENDING','ACCEPTED','REJECTED','CANCELLED','BLOCKED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MessageType') THEN
    CREATE TYPE "MessageType" AS ENUM ('TEXT','GIFT','GIFT_WITH_MESSAGE','GIF','GIF_WITH_MESSAGE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ConversationSection') THEN
    CREATE TYPE "ConversationSection" AS ENUM ('INBOX','RECEIVED_REQUESTS','SENT_REQUESTS');
  END IF;
END $$;

-- Tables
CREATE TABLE IF NOT EXISTS "friend_requests" (
  "id" TEXT PRIMARY KEY,
  "fromUserId" TEXT NOT NULL,
  "toUserId" TEXT NOT NULL,
  "status" "FriendRequestStatus" NOT NULL DEFAULT 'PENDING',
  "message" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "acceptedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3)
);

CREATE UNIQUE INDEX IF NOT EXISTS "friend_requests_fromUserId_toUserId_key" ON "friend_requests"("fromUserId","toUserId");
CREATE INDEX IF NOT EXISTS "friend_requests_fromUserId_status_idx" ON "friend_requests"("fromUserId","status");
CREATE INDEX IF NOT EXISTS "friend_requests_toUserId_status_idx" ON "friend_requests"("toUserId","status");
CREATE INDEX IF NOT EXISTS "friend_requests_createdAt_idx" ON "friend_requests"("createdAt");
CREATE INDEX IF NOT EXISTS "friend_requests_expiresAt_idx" ON "friend_requests"("expiresAt");

CREATE TABLE IF NOT EXISTS "friends" (
  "id" TEXT PRIMARY KEY,
  "userId1" TEXT NOT NULL,
  "userId2" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "friends_userId1_userId2_key" ON "friends"("userId1","userId2");
CREATE INDEX IF NOT EXISTS "friends_userId1_idx" ON "friends"("userId1");
CREATE INDEX IF NOT EXISTS "friends_userId2_idx" ON "friends"("userId2");

CREATE TABLE IF NOT EXISTS "friend_messages" (
  "id" TEXT PRIMARY KEY,
  "fromUserId" TEXT NOT NULL,
  "toUserId" TEXT NOT NULL,
  "message" TEXT,
  "gifProvider" TEXT,
  "gifId" TEXT,
  "gifUrl" TEXT,
  "gifPreviewUrl" TEXT,
  "gifWidth" INTEGER,
  "gifHeight" INTEGER,
  "isRead" BOOLEAN NOT NULL DEFAULT FALSE,
  "readAt" TIMESTAMP(3),
  "transactionId" TEXT,
  "giftId" TEXT,
  "giftAmount" INTEGER,
  "messageType" "MessageType" NOT NULL DEFAULT 'TEXT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "friend_messages_from_to_created_idx" ON "friend_messages"("fromUserId","toUserId","createdAt");
CREATE INDEX IF NOT EXISTS "friend_messages_to_isRead_idx" ON "friend_messages"("toUserId","isRead");
CREATE INDEX IF NOT EXISTS "friend_messages_createdAt_idx" ON "friend_messages"("createdAt");
CREATE INDEX IF NOT EXISTS "friend_messages_messageType_idx" ON "friend_messages"("messageType");

CREATE TABLE IF NOT EXISTS "conversations" (
  "id" TEXT PRIMARY KEY,
  "userId1" TEXT NOT NULL,
  "userId2" TEXT NOT NULL,
  "section" "ConversationSection" NOT NULL DEFAULT 'INBOX',
  "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "lastMessageId" TEXT,
  "user1LastReadAt" TIMESTAMP(3),
  "user2LastReadAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "conversations_userId1_userId2_key" ON "conversations"("userId1","userId2");
CREATE INDEX IF NOT EXISTS "conversations_userId1_section_lastMessageAt_idx" ON "conversations"("userId1","section","lastMessageAt");
CREATE INDEX IF NOT EXISTS "conversations_userId2_section_lastMessageAt_idx" ON "conversations"("userId2","section","lastMessageAt");

CREATE TABLE IF NOT EXISTS "gifts" (
  "id" TEXT PRIMARY KEY,
  "giftId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "emoji" TEXT NOT NULL,
  "coins" INTEGER NOT NULL,
  "diamonds" INTEGER NOT NULL DEFAULT 0,
  "imageUrl" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "gifts_giftId_key" ON "gifts"("giftId");
CREATE INDEX IF NOT EXISTS "gifts_giftId_idx" ON "gifts"("giftId");
CREATE INDEX IF NOT EXISTS "gifts_isActive_idx" ON "gifts"("isActive");

-- section_last_seen is created by a later migration in this repo; keep for idempotency if present.
