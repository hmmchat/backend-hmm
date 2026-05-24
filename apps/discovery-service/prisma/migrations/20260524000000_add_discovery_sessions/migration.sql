-- CreateTable
CREATE TABLE "discovery_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "intent" TEXT NOT NULL DEFAULT 'solo',
    "lastHeartbeat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discovery_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "discovery_sessions_userId_key" ON "discovery_sessions"("userId");

-- CreateIndex
CREATE INDEX "discovery_sessions_expiresAt_idx" ON "discovery_sessions"("expiresAt");
