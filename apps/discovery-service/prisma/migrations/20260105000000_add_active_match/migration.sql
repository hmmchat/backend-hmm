-- CreateTable
CREATE TABLE IF NOT EXISTS "active_matches" (
    "id" TEXT NOT NULL,
    "user1Id" TEXT NOT NULL,
    "user2Id" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "active_matches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "active_matches_user1Id_idx" ON "active_matches"("user1Id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "active_matches_user2Id_idx" ON "active_matches"("user2Id");

-- CreateUniqueIndex
CREATE UNIQUE INDEX IF NOT EXISTS "active_matches_user1Id_user2Id_key" ON "active_matches"("user1Id", "user2Id");

