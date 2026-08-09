-- CreateEnum
CREATE TYPE "CoinMiningBucket" AS ENUM ('BROADCAST', 'VIDEO_CALL', 'VIEWER');

-- CreateTable
CREATE TABLE "user_coin_mining_progress" (
    "userId" TEXT NOT NULL,
    "broadcastRemainderSeconds" INTEGER NOT NULL DEFAULT 0,
    "videoCallRemainderSeconds" INTEGER NOT NULL DEFAULT 0,
    "viewerRemainderSeconds" INTEGER NOT NULL DEFAULT 0,
    "faceCardRewardedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_coin_mining_progress_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "coin_mining_active_sessions" (
    "userId" TEXT NOT NULL,
    "bucket" "CoinMiningBucket" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSettledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "roomId" TEXT,
    "sessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coin_mining_active_sessions_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "coin_mining_referral_payouts" (
    "id" TEXT NOT NULL,
    "referredUserId" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "referrerReward" INTEGER NOT NULL,
    "referrerTransactionId" TEXT,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coin_mining_referral_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "coin_mining_active_sessions_bucket_idx" ON "coin_mining_active_sessions"("bucket");

-- CreateIndex
CREATE UNIQUE INDEX "coin_mining_referral_payouts_referredUserId_key" ON "coin_mining_referral_payouts"("referredUserId");

-- CreateIndex
CREATE INDEX "coin_mining_referral_payouts_referrerId_idx" ON "coin_mining_referral_payouts"("referrerId");
