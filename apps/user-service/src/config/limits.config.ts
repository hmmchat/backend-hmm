/**
 * User-service list and nearby defaults.
 * All values are read from environment variables with defaults matching original behavior.
 */

function intEnv(name: string, defaultVal: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return defaultVal;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? defaultVal : n;
}

function floatEnv(name: string, defaultVal: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return defaultVal;
  const n = parseFloat(v);
  return Number.isNaN(n) ? defaultVal : n;
}

/** Default radius (km) for GET /users/nearby */
export const NEARBY_DEFAULT_RADIUS_KM = floatEnv("NEARBY_DEFAULT_RADIUS_KM", 10);

/** Default limit for GET /users/nearby */
export const NEARBY_DEFAULT_LIMIT = intEnv("NEARBY_DEFAULT_LIMIT", 50);

/** Default limit for GET /metrics/cities */
export const CITIES_MAX_USERS_DEFAULT_LIMIT = intEnv("CITIES_MAX_USERS_DEFAULT_LIMIT", 20);

/** Default limit for POST /users/discovery */
export const DISCOVERY_USERS_DEFAULT_LIMIT = intEnv("DISCOVERY_USERS_DEFAULT_LIMIT", 100);

/** Default limit for GET /brands/search and GET /music/search */
export const SEARCH_DEFAULT_LIMIT = intEnv("SEARCH_DEFAULT_LIMIT", 20);
