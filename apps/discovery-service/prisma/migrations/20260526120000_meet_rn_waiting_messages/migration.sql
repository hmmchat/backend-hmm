-- CreateTable
CREATE TABLE "meet_rn_waiting_messages" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "meet_rn_waiting_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meet_rn_waiting_messages_isActive_idx" ON "meet_rn_waiting_messages"("isActive");
