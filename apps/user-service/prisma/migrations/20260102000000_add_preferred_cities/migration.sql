-- AlterTable
ALTER TABLE "users" ADD COLUMN "preferredCities" TEXT[] DEFAULT ARRAY[]::TEXT[];

