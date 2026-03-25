-- Content-managed vs Brandfetch-imported brands (dashboard lists isCustom = true only)
ALTER TABLE "brands" ADD COLUMN "isCustom" BOOLEAN NOT NULL DEFAULT true;

-- Best-effort: rows that clearly came from Brandfetch CDN should not appear in the content catalog
UPDATE "brands"
SET "isCustom" = false
WHERE "logoUrl" IS NOT NULL
  AND ("logoUrl" LIKE '%cdn.brandfetch.io%' OR "logoUrl" LIKE '%asset.brandfetch.io%');
