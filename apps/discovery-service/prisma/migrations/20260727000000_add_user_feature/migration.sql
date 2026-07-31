-- Add UserFeature and FeatureGenerationJob tables
-- Migration: 20260727000000_add_user_feature

-- UserFeature table (intent-only vectors; provider marks hosted vs non-semantic fallback)
CREATE TABLE "user_features" (
    "userId" TEXT NOT NULL,
    "vector" JSONB NOT NULL,
    "intent" TEXT,
    "checksum" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "provider" TEXT NOT NULL DEFAULT 'hosted',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_features_pkey" PRIMARY KEY ("userId")
);

CREATE INDEX "user_features_provider_idx" ON "user_features"("provider");

-- FeatureGenerationJob table
CREATE TABLE "feature_generation_jobs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "leasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_generation_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "feature_generation_jobs_userId_key" ON "feature_generation_jobs"("userId");
CREATE INDEX "feature_generation_jobs_status_idx" ON "feature_generation_jobs"("status");
CREATE INDEX "feature_generation_jobs_userId_idx" ON "feature_generation_jobs"("userId");
CREATE INDEX "feature_generation_jobs_status_leasedAt_idx" ON "feature_generation_jobs"("status", "leasedAt");
