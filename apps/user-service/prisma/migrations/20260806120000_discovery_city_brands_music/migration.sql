-- AlterTable
ALTER TABLE "discovery_city_options" ADD COLUMN "musicPreferenceId" TEXT;

-- CreateTable
CREATE TABLE "discovery_city_brands" (
    "id" TEXT NOT NULL,
    "cityOptionId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discovery_city_brands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "discovery_city_options_musicPreferenceId_idx" ON "discovery_city_options"("musicPreferenceId");

-- CreateIndex
CREATE INDEX "discovery_city_brands_cityOptionId_idx" ON "discovery_city_brands"("cityOptionId");

-- CreateIndex
CREATE UNIQUE INDEX "discovery_city_brands_cityOptionId_brandId_key" ON "discovery_city_brands"("cityOptionId", "brandId");

-- CreateIndex
CREATE UNIQUE INDEX "discovery_city_brands_cityOptionId_order_key" ON "discovery_city_brands"("cityOptionId", "order");

-- AddForeignKey
ALTER TABLE "discovery_city_options" ADD CONSTRAINT "discovery_city_options_musicPreferenceId_fkey" FOREIGN KEY ("musicPreferenceId") REFERENCES "songs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_city_brands" ADD CONSTRAINT "discovery_city_brands_cityOptionId_fkey" FOREIGN KEY ("cityOptionId") REFERENCES "discovery_city_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_city_brands" ADD CONSTRAINT "discovery_city_brands_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
