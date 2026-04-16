/**
 * Stored in user-service `users.preferredCity` when the user chose
 * "Anywhere in India" (all cities / full discovery pool).
 */
export const PREFERRED_CITY_ANYWHERE_IN_INDIA = "ANYWHERE_IN_INDIA" as const;

export function isPreferredCityAnywhere(preferredCity: string | null | undefined): boolean {
  if (preferredCity === null || preferredCity === undefined) return true;
  if (preferredCity === "") return true;
  return preferredCity === PREFERRED_CITY_ANYWHERE_IN_INDIA;
}
