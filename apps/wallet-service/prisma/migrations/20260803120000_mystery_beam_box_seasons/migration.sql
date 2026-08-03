-- CreateEnum
CREATE TYPE "SeasonStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "SeasonTaskType" AS ENUM ('UNIQUE_STRANGERS', 'BEAM_MINUTES', 'BEAMCAST_MINUTES', 'DIAMONDS_EARNED');

-- CreateEnum
CREATE TYPE "SeasonClaimStatus" AS ENUM ('PENDING', 'REJECTED', 'APPROVED', 'GIFT_SENT', 'GIFT_RECEIVED');

-- CreateTable
CREATE TABLE "seasons" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "SeasonStatus" NOT NULL DEFAULT 'DRAFT',
    "giftPoolSize" INTEGER NOT NULL DEFAULT 1000,
    "approvedCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "season_tasks" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "taskType" "SeasonTaskType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "target" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "season_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_season_progress" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "uniqueStrangers" INTEGER NOT NULL DEFAULT 0,
    "beamSeconds" INTEGER NOT NULL DEFAULT 0,
    "beamcastSeconds" INTEGER NOT NULL DEFAULT 0,
    "diamondsEarned" INTEGER NOT NULL DEFAULT 0,
    "tasksCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_season_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_call_peers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "peerUserId" TEXT NOT NULL,
    "firstConnectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_call_peers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "season_claims" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "SeasonClaimStatus" NOT NULL DEFAULT 'PENDING',
    "recipientName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "addressLine3" TEXT,
    "landmark" TEXT,
    "state" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "rejectMessage" TEXT,
    "courierName" TEXT,
    "trackingNumber" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "giftSentAt" TIMESTAMP(3),
    "giftReceivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "season_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "season_progress_events" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "season_progress_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "seasons_status_idx" ON "seasons"("status");

-- CreateIndex
CREATE INDEX "season_tasks_seasonId_idx" ON "season_tasks"("seasonId");

-- CreateIndex
CREATE UNIQUE INDEX "season_tasks_seasonId_taskType_key" ON "season_tasks"("seasonId", "taskType");

-- CreateIndex
CREATE INDEX "user_season_progress_userId_idx" ON "user_season_progress"("userId");

-- CreateIndex
CREATE INDEX "user_season_progress_seasonId_idx" ON "user_season_progress"("seasonId");

-- CreateIndex
CREATE UNIQUE INDEX "user_season_progress_seasonId_userId_key" ON "user_season_progress"("seasonId", "userId");

-- CreateIndex
CREATE INDEX "user_call_peers_userId_idx" ON "user_call_peers"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_call_peers_userId_peerUserId_key" ON "user_call_peers"("userId", "peerUserId");

-- CreateIndex
CREATE INDEX "season_claims_seasonId_status_idx" ON "season_claims"("seasonId", "status");

-- CreateIndex
CREATE INDEX "season_claims_userId_idx" ON "season_claims"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "season_claims_seasonId_userId_key" ON "season_claims"("seasonId", "userId");

-- CreateIndex
CREATE INDEX "season_progress_events_seasonId_idx" ON "season_progress_events"("seasonId");

-- CreateIndex
CREATE UNIQUE INDEX "season_progress_events_seasonId_userId_eventKey_key" ON "season_progress_events"("seasonId", "userId", "eventKey");

-- AddForeignKey
ALTER TABLE "season_tasks" ADD CONSTRAINT "season_tasks_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_season_progress" ADD CONSTRAINT "user_season_progress_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_claims" ADD CONSTRAINT "season_claims_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_progress_events" ADD CONSTRAINT "season_progress_events_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
