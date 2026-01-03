-- CreateTable
CREATE TABLE "raincheck_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "raincheckedUserId" TEXT NOT NULL,
    "city" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raincheck_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "raincheck_sessions_userId_sessionId_idx" ON "raincheck_sessions"("userId", "sessionId");

-- CreateIndex
CREATE INDEX "raincheck_sessions_userId_city_sessionId_idx" ON "raincheck_sessions"("userId", "city", "sessionId");

