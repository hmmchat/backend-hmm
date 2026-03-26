-- CreateTable
CREATE TABLE "zodiacs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zodiacs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "zodiacs_name_key" ON "zodiacs"("name");

-- CreateIndex
CREATE INDEX "zodiacs_order_idx" ON "zodiacs"("order");

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "zodiacId" TEXT;
ALTER TABLE "users" ADD COLUMN     "zodiacOverridden" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_zodiacId_fkey" FOREIGN KEY ("zodiacId") REFERENCES "zodiacs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

