-- CreateTable
CREATE TABLE "user_hidden_call_history" (
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_hidden_call_history_pkey" PRIMARY KEY ("userId","sessionId")
);

-- CreateIndex
CREATE INDEX "user_hidden_call_history_userId_idx" ON "user_hidden_call_history"("userId");

-- CreateIndex
CREATE INDEX "user_hidden_call_history_sessionId_idx" ON "user_hidden_call_history"("sessionId");
