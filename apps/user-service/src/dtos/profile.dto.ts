import { z } from "zod";
import { PREFERRED_CITY_ANYWHERE_IN_INDIA } from "@hmm/common";

export const GenderEnum = z.enum(["MALE", "FEMALE", "NON_BINARY", "PREFER_NOT_TO_SAY"]);

export const UserStatusEnum = z.enum([
  "AVAILABLE",
  "ONLINE",
  "OFFLINE",
  "MATCHED",
  "IN_SQUAD",
  "IN_SQUAD_AVAILABLE",
  "IN_BROADCAST",
  "IN_BROADCAST_AVAILABLE",
  "VIEWER"
]);

// Profile Creation/Update DTO
export const CreateProfileSchema = z.object({
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores"),
  dateOfBirth: z.string().datetime().or(z.date()).transform((val) => new Date(val)),
  gender: GenderEnum,
  displayPictureUrl: z.string().url(),
  /** Must be an active admin catalog `value`, typically `ANYWHERE_IN_INDIA` or a city value. */
  preferredCity: z.string().min(1).max(100),
  intent: z.string().max(255).optional()
});

export const UpdateProfileSchema = z.object({
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/).optional(),
  gender: GenderEnum.optional(),
  displayPictureUrl: z.string().url().optional(),
  intent: z.string().max(255).optional(),
  musicPreferenceId: z.string().optional(),
  videoEnabled: z.boolean().optional()
});

// Photo DTOs
export const CreatePhotoSchema = z.object({
  url: z.string().url(),
  order: z.number().int().min(0).max(2)
});

// Preferences DTOs
export const UpdateBrandPreferencesSchema = z.object({
  brandIds: z.array(z.string()).min(1).max(5)
});

export const UpdateInterestsSchema = z.object({
  interestIds: z.array(z.string()).min(0).max(4)
});

export const UpdateValuesSchema = z.object({
  valueIds: z.array(z.string()).min(0).max(4)
});

// Location DTO
export const UpdateLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180)
});

// Preferred City DTO — null/omitted maps to "Anywhere in India" sentinel for backwards compatibility
export const UpdatePreferredCitySchema = z.object({
  city: z
    .string()
    .min(1)
    .max(100)
    .nullable()
    .optional()
    .transform((v) => (v === undefined || v === null ? PREFERRED_CITY_ANYWHERE_IN_INDIA : v))
});

// Status DTO
export const UpdateStatusSchema = z.object({
  status: UserStatusEnum
});

// Intent DTO
export const UpdateIntentSchema = z.object({
  intent: z.string().max(255).nullable() // Increased limit to allow longer bios
});

// Music Preference DTO
export const CreateMusicPreferenceSchema = z.object({
  songName: z.string().min(1),
  artistName: z.string().min(1),
  albumArtUrl: z.string().url().optional().nullable(),
  spotifyId: z.string().optional()
});

export type CreateProfileDto = z.infer<typeof CreateProfileSchema>;
export type UpdateProfileDto = z.infer<typeof UpdateProfileSchema>;
export type CreatePhotoDto = z.infer<typeof CreatePhotoSchema>;
export type UpdateBrandPreferencesDto = z.infer<typeof UpdateBrandPreferencesSchema>;
export type UpdateInterestsDto = z.infer<typeof UpdateInterestsSchema>;
export type UpdateValuesDto = z.infer<typeof UpdateValuesSchema>;
export type UpdateLocationDto = z.infer<typeof UpdateLocationSchema>;
export type UpdatePreferredCityDto = z.infer<typeof UpdatePreferredCitySchema>;
export type UpdateStatusDto = z.infer<typeof UpdateStatusSchema>;
export type UpdateIntentDto = z.infer<typeof UpdateIntentSchema>;
export type CreateMusicPreferenceDto = z.infer<typeof CreateMusicPreferenceSchema>;

