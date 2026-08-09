/**
 * Admin dashboard catalog upload folders.
 * Trusted operator assets — SVG allowed; never run Sightengine
 * (moderation is reserved for end-user profile-photos only).
 */
export const DASHBOARD_CATALOG_FOLDERS = [
  "zodiacs",
  "brand-logos",
  "gift-images",
  "discovery-city-faces",
  "loading-memes",
  "notifications",
  "moderator-face-card"
] as const;

export type DashboardCatalogFolder = (typeof DASHBOARD_CATALOG_FOLDERS)[number];
