/**
 * Brand browse categories shown in the picker and required on dashboard-uploaded brands.
 * Aligned with Brandfetch-style tabs; "Featured" is intentionally omitted.
 */
export const BRAND_CATEGORY_NAMES = [
  "Technology",
  "Arts and Entertainment",
  "Finance",
  "Food and Drink",
  "Vehicles",
  "Travel and tourism",
  "Shopping",
  "Fashion",
  "Sports",
  "Beauty",
  "Media",
  "Healthcare",
  "Gaming",
  "Education",
  "Music",
  "Telecom"
] as const;

export type BrandCategoryName = (typeof BRAND_CATEGORY_NAMES)[number];

export function normalizeBrandCategory(value: string | null | undefined): BrandCategoryName | null {
  const needle = (value || "").trim().toLowerCase();
  if (!needle) return null;
  return BRAND_CATEGORY_NAMES.find((name) => name.toLowerCase() === needle) ?? null;
}

export function isBrandCategory(value: string | null | undefined): boolean {
  return normalizeBrandCategory(value) != null;
}
