import { z } from "zod";

export const UpdateZodiacSchema = z.object({
  zodiacId: z.string().min(1)
});

export type UpdateZodiacDto = z.infer<typeof UpdateZodiacSchema>;

