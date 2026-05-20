-- CreateIndex
CREATE INDEX IF NOT EXISTS "call_sessions_status_startedAt_idx" ON "call_sessions"("status", "startedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "call_sessions_isBroadcasting_status_startedAt_idx" ON "call_sessions"("isBroadcasting", "status", "startedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "call_sessions_isTrending_isBroadcasting_status_popularityScore_idx" ON "call_sessions"("isTrending", "isBroadcasting", "status", "popularityScore");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "call_participants_userId_status_leftAt_idx" ON "call_participants"("userId", "status", "leftAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "call_participants_sessionId_status_leftAt_idx" ON "call_participants"("sessionId", "status", "leftAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "call_viewers_userId_leftAt_idx" ON "call_viewers"("userId", "leftAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "call_viewers_sessionId_leftAt_idx" ON "call_viewers"("sessionId", "leftAt");
