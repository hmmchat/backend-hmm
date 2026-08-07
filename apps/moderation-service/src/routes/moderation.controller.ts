import { Controller, Post, Body } from "@nestjs/common";
import { ModerationService, ModerationPurpose } from "../services/moderation.service.js";
import { z } from "zod";

const CheckImageSchema = z.object({
  imageUrl: z.string().url("Invalid image URL"),
  /** display = DP (person-focused); gallery = slots 2–3 (groups/objects OK). */
  purpose: z.enum(["display", "gallery"]).optional().default("display")
});

@Controller("moderation")
export class ModerationController {
  constructor(private readonly moderationService: ModerationService) {}

  @Post("check-image")
  async checkImage(@Body() body: any) {
    const { imageUrl, purpose } = CheckImageSchema.parse(body);
    const result = await this.moderationService.checkImage(imageUrl, purpose as ModerationPurpose);
    return result;
  }
}
