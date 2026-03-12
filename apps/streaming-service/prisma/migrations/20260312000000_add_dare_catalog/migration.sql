-- CreateTable
CREATE TABLE "dare_catalog" (
    "id" TEXT NOT NULL,
    "dareId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "category" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dare_catalog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dare_catalog_dareId_key" ON "dare_catalog"("dareId");

-- CreateIndex
CREATE INDEX "dare_catalog_isActive_idx" ON "dare_catalog"("isActive");

-- CreateIndex
CREATE INDEX "dare_catalog_category_idx" ON "dare_catalog"("category");
