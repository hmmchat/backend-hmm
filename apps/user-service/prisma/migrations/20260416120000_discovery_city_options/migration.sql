-- CreateTable
CREATE TABLE "discovery_city_options" (
    "id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "order" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discovery_city_options_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "discovery_city_options_value_key" ON "discovery_city_options"("value");

-- Normalize legacy "anywhere" to explicit sentinel
UPDATE "users" SET "preferredCity" = 'ANYWHERE_IN_INDIA' WHERE "preferredCity" IS NULL;

INSERT INTO "discovery_city_options" ("id", "value", "label", "order", "isActive", "createdAt", "updatedAt")
VALUES ('cldiscoverycityanywhere', 'ANYWHERE_IN_INDIA', 'Anywhere in India', 0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
