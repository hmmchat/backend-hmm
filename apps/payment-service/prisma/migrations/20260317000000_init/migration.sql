-- CreateEnum
CREATE TYPE "PaymentOrderStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "RedemptionStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED', 'IGNORED');

-- CreateTable
CREATE TABLE "payment_orders" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountInr" INTEGER NOT NULL,
    "coinsAmount" INTEGER NOT NULL,
    "razorpayOrderId" TEXT,
    "razorpayPaymentId" TEXT,
    "status" "PaymentOrderStatus" NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "redemption_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "originalDiamonds" INTEGER NOT NULL,
    "finalDiamonds" INTEGER NOT NULL,
    "coinsDeducted" INTEGER NOT NULL,
    "diamondsDeducted" INTEGER NOT NULL DEFAULT 0,
    "inrAmount" INTEGER NOT NULL,
    "upsellLevel" INTEGER NOT NULL DEFAULT 0,
    "status" "RedemptionStatus" NOT NULL DEFAULT 'PENDING',
    "razorpayPayoutId" TEXT,
    "bankAccountNumber" TEXT,
    "bankIfsc" TEXT,
    "bankAccountName" TEXT,
    "failureReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "redemption_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_webhooks" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "signature" TEXT,
    "status" "WebhookStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_configurations" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_orders_razorpayOrderId_key" ON "payment_orders"("razorpayOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_orders_razorpayPaymentId_key" ON "payment_orders"("razorpayPaymentId");

-- CreateIndex
CREATE INDEX "payment_orders_userId_idx" ON "payment_orders"("userId");

-- CreateIndex
CREATE INDEX "payment_orders_status_idx" ON "payment_orders"("status");

-- CreateIndex
CREATE INDEX "payment_orders_razorpayOrderId_idx" ON "payment_orders"("razorpayOrderId");

-- CreateIndex
CREATE INDEX "payment_orders_createdAt_idx" ON "payment_orders"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "redemption_requests_razorpayPayoutId_key" ON "redemption_requests"("razorpayPayoutId");

-- CreateIndex
CREATE INDEX "redemption_requests_userId_idx" ON "redemption_requests"("userId");

-- CreateIndex
CREATE INDEX "redemption_requests_status_idx" ON "redemption_requests"("status");

-- CreateIndex
CREATE INDEX "redemption_requests_razorpayPayoutId_idx" ON "redemption_requests"("razorpayPayoutId");

-- CreateIndex
CREATE INDEX "redemption_requests_createdAt_idx" ON "redemption_requests"("createdAt");

-- CreateIndex
CREATE INDEX "payment_webhooks_eventType_idx" ON "payment_webhooks"("eventType");

-- CreateIndex
CREATE INDEX "payment_webhooks_status_idx" ON "payment_webhooks"("status");

-- CreateIndex
CREATE INDEX "payment_webhooks_createdAt_idx" ON "payment_webhooks"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_configurations_key_key" ON "payment_configurations"("key");

