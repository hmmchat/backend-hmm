import { Controller, Post, Body } from "@nestjs/common";
import { ModerationService } from "../services/moderation.service.js";
import { z } from "zod";

const CheckImageSchema = z.object({
  imageUrl: z.string().url("Invalid image URL")
});

@Controller("moderation")
export class ModerationController {
  constructor(private readonly moderationService: ModerationService) {}

  @Post("check-image")
  async checkImage(@Body() body: any) {
    const { imageUrl } = CheckImageSchema.parse(body);
    const result = await this.moderationService.checkImage(imageUrl);
    return result;
  }
}

