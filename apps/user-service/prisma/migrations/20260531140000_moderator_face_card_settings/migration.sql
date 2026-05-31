-- Shared moderator discovery face card (dashboard-managed singleton).
CREATE TABLE "moderator_face_card_settings" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "username" TEXT NOT NULL DEFAULT 'Moderator',
  "intent" TEXT NOT NULL DEFAULT 'Moderation',
  "displayPictureUrl" TEXT,
  "city" TEXT NOT NULL DEFAULT 'Beam',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "moderator_face_card_settings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "moderator_face_card_settings" ("id", "username", "intent", "city", "updatedAt")
VALUES ('default', 'Moderator', 'Moderation', 'Beam', CURRENT_TIMESTAMP);
