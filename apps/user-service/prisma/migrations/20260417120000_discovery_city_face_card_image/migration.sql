-- Optional image URL shown on LOCATION discovery cards for this catalog city.
ALTER TABLE "discovery_city_options" ADD COLUMN IF NOT EXISTS "faceCardImageUrl" TEXT;
