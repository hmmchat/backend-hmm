import { z } from "zod";

// DTO for updating preferred city
export const UpdatePreferredCitySchema = z.object({
  city: z.string().min(1).max(100).nullable() // Single preferred city, null means no preference
});

// DTO for locate me (reverse geocoding)
export const LocateMeSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180)
});

// DTO for searching cities
export const SearchCitiesSchema = z.object({
  q: z.string().min(1).max(100) // Search query
});

export type UpdatePreferredCityDto = z.infer<typeof UpdatePreferredCitySchema>;
export type LocateMeDto = z.infer<typeof LocateMeSchema>;
export type SearchCitiesDto = z.infer<typeof SearchCitiesSchema>;

