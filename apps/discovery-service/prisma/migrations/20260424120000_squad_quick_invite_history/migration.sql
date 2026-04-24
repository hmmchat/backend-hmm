-- Squad quick-invite: persist up to 3 MRU friend co-participants per user (discovery DB).

CREATE TABLE "squad_quick_invite_histories" (
    "userId" TEXT NOT NULL,
    "peerIds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "squad_quick_invite_histories_pkey" PRIMARY KEY ("userId")
);
