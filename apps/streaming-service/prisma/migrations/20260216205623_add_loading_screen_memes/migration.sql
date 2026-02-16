-- CreateTable
CREATE TABLE "loading_screen_memes" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "category" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "loading_screen_memes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "loading_screen_memes_isActive_idx" ON "loading_screen_memes"("isActive");

-- CreateIndex
CREATE INDEX "loading_screen_memes_category_idx" ON "loading_screen_memes"("category");
