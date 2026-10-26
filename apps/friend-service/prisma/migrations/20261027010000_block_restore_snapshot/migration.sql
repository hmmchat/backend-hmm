-- Remember where a chat lived before a block, so unblock can put it back.
ALTER TABLE "friend_requests" ADD COLUMN "statusBeforeBlock" "FriendRequestStatus",
ADD COLUMN "blockInitiated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "restoreFriendship" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "conversations" ADD COLUMN "sectionBeforeBlock" "ConversationSection",
ADD COLUMN "friendsBeforeBlock" BOOLEAN NOT NULL DEFAULT false;
