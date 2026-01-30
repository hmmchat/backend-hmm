/**
 * Discovery pool and location limits.
 * All values are read from environment variables with defaults matching original behavior.
 */

function intEnv(name: string, defaultVal: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return defaultVal;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? defaultVal : n;
}

/** Max users to fetch for card pool / matching */
export const DISCOVERY_POOL_LIMIT = intEnv("DISCOVERY_POOL_LIMIT", 500);

/** Max users per city for cities/nearby endpoints */
export const CITIES_MAX_USERS_LIMIT = intEnv("CITIES_MAX_USERS_LIMIT", 100);
