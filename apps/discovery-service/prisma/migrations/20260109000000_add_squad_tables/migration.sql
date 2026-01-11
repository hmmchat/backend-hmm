-- CreateEnum
CREATE TYPE "SquadInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SquadLobbyStatus" AS ENUM ('WAITING', 'READY', 'IN_CALL');

-- CreateTable
CREATE TABLE "squad_invitations" (
    "id" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "inviteeId" TEXT,
    "inviteToken" TEXT,
    "status" "SquadInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),

    CONSTRAINT "squad_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "squad_lobbies" (
    "id" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "memberIds" JSONB NOT NULL,
    "status" "SquadLobbyStatus" NOT NULL DEFAULT 'WAITING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "enteredCallAt" TIMESTAMP(3),

    CONSTRAINT "squad_lobbies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "squad_invitations_inviterId_status_idx" ON "squad_invitations"("inviterId", "status");

-- CreateIndex
CREATE INDEX "squad_invitations_inviteeId_status_idx" ON "squad_invitations"("inviteeId", "status");

-- CreateIndex
CREATE INDEX "squad_invitations_inviteToken_idx" ON "squad_invitations"("inviteToken");

-- CreateIndex
CREATE INDEX "squad_invitations_expiresAt_idx" ON "squad_invitations"("expiresAt");

-- CreateIndex
CREATE INDEX "squad_invitations_status_idx" ON "squad_invitations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "squad_invitations_inviteToken_key" ON "squad_invitations"("inviteToken");

-- CreateIndex
CREATE INDEX "squad_lobbies_inviterId_idx" ON "squad_lobbies"("inviterId");

-- CreateIndex
CREATE INDEX "squad_lobbies_status_idx" ON "squad_lobbies"("status");

-- CreateIndex
CREATE UNIQUE INDEX "squad_lobbies_inviterId_key" ON "squad_lobbies"("inviterId");
