-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'NON_BINARY', 'PREFER_NOT_TO_SAY');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('IDLE', 'IN_MATCHMAKING', 'IN_ONE_ON_ONE_CALL', 'IN_SQUAD', 'IN_BROADCAST', 'WATCHING_HMM_TV');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "username" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "gender" "Gender",
    "genderChanged" BOOLEAN NOT NULL DEFAULT false,
    "displayPictureUrl" TEXT,
    "musicPreferenceId" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'IDLE',
    "reported" BOOLEAN NOT NULL DEFAULT false,
    "badgeMember" BOOLEAN NOT NULL DEFAULT false,
    "intent" VARCHAR(50),
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "locationUpdatedAt" TIMESTAMP(3),
    "videoEnabled" BOOLEAN NOT NULL DEFAULT true,
    "profileCompleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_photos" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "songs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "spotifyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "songs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_brands" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interests" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_interests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "interestId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_interests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "values" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_values" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "valueId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_values_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_username_idx" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "users_latitude_longitude_idx" ON "users"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "user_photos_userId_idx" ON "user_photos"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_photos_userId_order_key" ON "user_photos"("userId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "songs_spotifyId_key" ON "songs"("spotifyId");

-- CreateIndex
CREATE INDEX "songs_name_artist_idx" ON "songs"("name", "artist");

-- CreateIndex
CREATE UNIQUE INDEX "songs_name_artist_key" ON "songs"("name", "artist");

-- CreateIndex
CREATE UNIQUE INDEX "brands_name_key" ON "brands"("name");

-- CreateIndex
CREATE INDEX "user_brands_userId_idx" ON "user_brands"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_brands_userId_brandId_key" ON "user_brands"("userId", "brandId");

-- CreateIndex
CREATE UNIQUE INDEX "user_brands_userId_order_key" ON "user_brands"("userId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "interests_name_key" ON "interests"("name");

-- CreateIndex
CREATE INDEX "user_interests_userId_idx" ON "user_interests"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_interests_userId_interestId_key" ON "user_interests"("userId", "interestId");

-- CreateIndex
CREATE UNIQUE INDEX "user_interests_userId_order_key" ON "user_interests"("userId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "values_name_key" ON "values"("name");

-- CreateIndex
CREATE INDEX "user_values_userId_idx" ON "user_values"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_values_userId_valueId_key" ON "user_values"("userId", "valueId");

-- CreateIndex
CREATE UNIQUE INDEX "user_values_userId_order_key" ON "user_values"("userId", "order");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_musicPreferenceId_fkey" FOREIGN KEY ("musicPreferenceId") REFERENCES "songs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_photos" ADD CONSTRAINT "user_photos_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_brands" ADD CONSTRAINT "user_brands_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_brands" ADD CONSTRAINT "user_brands_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_interests" ADD CONSTRAINT "user_interests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_interests" ADD CONSTRAINT "user_interests_interestId_fkey" FOREIGN KEY ("interestId") REFERENCES "interests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_values" ADD CONSTRAINT "user_values_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_values" ADD CONSTRAINT "user_values_valueId_fkey" FOREIGN KEY ("valueId") REFERENCES "values"("id") ON DELETE CASCADE ON UPDATE CASCADE;
