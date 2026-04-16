-- CreateTable
CREATE TABLE "session_discovery_city_overrides" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "poolCity" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_discovery_city_overrides_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "session_discovery_city_overrides_userId_sessionId_key" ON "session_discovery_city_overrides"("userId", "sessionId");
CREATE INDEX "session_discovery_city_overrides_userId_idx" ON "session_discovery_city_overrides"("userId");
