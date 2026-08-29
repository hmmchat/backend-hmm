-- AlterTable
ALTER TABLE "brands" ADD COLUMN "category" TEXT;

-- CreateIndex
CREATE INDEX "brands_category_idx" ON "brands"("category");
