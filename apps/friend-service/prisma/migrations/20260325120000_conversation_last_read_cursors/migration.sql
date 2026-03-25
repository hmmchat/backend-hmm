-- AlterTable
ALTER TABLE "conversations" ADD COLUMN "user1LastReadAt" TIMESTAMP(3),
ADD COLUMN "user2LastReadAt" TIMESTAMP(3);

-- Backfill: cursor = latest inbound message per direction so historical isRead:false rows do not inflate badges.
-- New unread = messages with createdAt strictly after this migration baseline.
UPDATE "conversations" c
SET "user1LastReadAt" = (
  SELECT MAX(m."createdAt") FROM "friend_messages" m
  WHERE m."fromUserId" = c."userId2" AND m."toUserId" = c."userId1"
)
WHERE EXISTS (
  SELECT 1 FROM "friend_messages" m
  WHERE m."fromUserId" = c."userId2" AND m."toUserId" = c."userId1"
);

UPDATE "conversations" c
SET "user2LastReadAt" = (
  SELECT MAX(m."createdAt") FROM "friend_messages" m
  WHERE m."fromUserId" = c."userId1" AND m."toUserId" = c."userId2"
)
WHERE EXISTS (
  SELECT 1 FROM "friend_messages" m
  WHERE m."fromUserId" = c."userId1" AND m."toUserId" = c."userId2"
);
