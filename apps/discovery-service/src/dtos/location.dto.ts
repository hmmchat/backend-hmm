import { z } from "zod";

// DTO for updating preferred cities
export const UpdatePreferredCitiesSchema = z.object({
  cities: z.array(z.string().min(1)).max(10) // Max 10 preferred cities
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

export type UpdatePreferredCitiesDto = z.infer<typeof UpdatePreferredCitiesSchema>;
export type LocateMeDto = z.infer<typeof LocateMeSchema>;
export type SearchCitiesDto = z.infer<typeof SearchCitiesSchema>;

