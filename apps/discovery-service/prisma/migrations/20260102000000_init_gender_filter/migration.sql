-- Note: Gender enum already exists in database from user-service
-- No need to create it again

-- CreateTable
CREATE TABLE "gender_filter_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "genders" JSONB NOT NULL,
    "screensRemaining" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gender_filter_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gender_filter_configs" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gender_filter_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gender_filter_preferences_userId_key" ON "gender_filter_preferences"("userId");

-- CreateIndex
CREATE INDEX "gender_filter_preferences_userId_idx" ON "gender_filter_preferences"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "gender_filter_configs_key_key" ON "gender_filter_configs"("key");

