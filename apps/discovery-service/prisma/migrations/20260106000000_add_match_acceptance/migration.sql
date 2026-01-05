-- CreateTable
CREATE TABLE "match_acceptances" (
    "id" TEXT NOT NULL,
    "user1Id" TEXT NOT NULL,
    "user2Id" TEXT NOT NULL,
    "acceptedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "match_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "match_acceptances_user1Id_user2Id_acceptedBy_key" ON "match_acceptances"("user1Id", "user2Id", "acceptedBy");

-- CreateIndex
CREATE INDEX "match_acceptances_user1Id_user2Id_idx" ON "match_acceptances"("user1Id", "user2Id");

-- CreateIndex
CREATE INDEX "match_acceptances_expiresAt_idx" ON "match_acceptances"("expiresAt");

