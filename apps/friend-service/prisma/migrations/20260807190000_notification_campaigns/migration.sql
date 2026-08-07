-- CreateEnum
CREATE TYPE "NotificationLine" AS ENUM ('BEAM', 'BEAM_MOD');

-- CreateEnum
CREATE TYPE "NotificationCampaignStatus" AS ENUM ('SENDING', 'SENT', 'RECALLED');

-- CreateTable
CREATE TABLE "notification_campaigns" (
    "id" TEXT NOT NULL,
    "line" "NotificationLine" NOT NULL,
    "status" "NotificationCampaignStatus" NOT NULL DEFAULT 'SENDING',
    "body" TEXT NOT NULL,
    "title" TEXT,
    "imagesJson" TEXT,
    "ctasJson" TEXT,
    "richJson" TEXT,
    "audienceRegisteredBefore" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "recalledAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_campaign_recipients" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_campaign_deliveries" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_campaign_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_campaigns_line_status_sentAt_idx" ON "notification_campaigns"("line", "status", "sentAt");

-- CreateIndex
CREATE INDEX "notification_campaigns_line_createdAt_idx" ON "notification_campaigns"("line", "createdAt");

-- CreateIndex
CREATE INDEX "notification_campaign_recipients_userId_idx" ON "notification_campaign_recipients"("userId");

-- CreateIndex
CREATE INDEX "notification_campaign_recipients_campaignId_idx" ON "notification_campaign_recipients"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_campaign_recipients_campaignId_userId_key" ON "notification_campaign_recipients"("campaignId", "userId");

-- CreateIndex
CREATE INDEX "notification_campaign_deliveries_userId_readAt_idx" ON "notification_campaign_deliveries"("userId", "readAt");

-- CreateIndex
CREATE INDEX "notification_campaign_deliveries_campaignId_idx" ON "notification_campaign_deliveries"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_campaign_deliveries_campaignId_userId_key" ON "notification_campaign_deliveries"("campaignId", "userId");

-- AddForeignKey
ALTER TABLE "notification_campaign_recipients" ADD CONSTRAINT "notification_campaign_recipients_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "notification_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_campaign_deliveries" ADD CONSTRAINT "notification_campaign_deliveries_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "notification_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
