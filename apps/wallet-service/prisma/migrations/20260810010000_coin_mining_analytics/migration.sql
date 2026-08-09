-- CreateTable
CREATE TABLE "coin_mining_analytics" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "broadcastMines" INTEGER NOT NULL DEFAULT 0,
    "videoCallMines" INTEGER NOT NULL DEFAULT 0,
    "viewerMines" INTEGER NOT NULL DEFAULT 0,
    "faceCardMines" INTEGER NOT NULL DEFAULT 0,
    "referralMines" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coin_mining_analytics_pkey" PRIMARY KEY ("id")
);

-- Seed singleton row
INSERT INTO "coin_mining_analytics" ("id", "broadcastMines", "videoCallMines", "viewerMines", "faceCardMines", "referralMines", "updatedAt", "createdAt")
VALUES ('global', 0, 0, 0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
