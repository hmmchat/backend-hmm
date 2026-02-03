-- CreateTable
CREATE TABLE "user_favourite_broadcaster" (
    "userId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_favourite_broadcaster_pkey" PRIMARY KEY ("userId","targetUserId")
);

-- CreateIndex
CREATE INDEX "user_favourite_broadcaster_userId_idx" ON "user_favourite_broadcaster"("userId");

-- CreateIndex
CREATE INDEX "user_favourite_broadcaster_targetUserId_idx" ON "user_favourite_broadcaster"("targetUserId");
