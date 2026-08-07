import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards
} from "@nestjs/common";
import { z } from "zod";
import { AdminAuthGuard } from "../guards/admin-auth.guard.js";
import { NotificationCampaignService } from "../services/notification-campaign.service.js";

const ctaSchema = z.object({
  label: z.string().min(1).max(80),
  url: z.string().min(1).max(2048),
  kind: z.enum(["deep", "external"]).default("external")
});

const createSchema = z.object({
  line: z.enum(["BEAM", "BEAM_MOD"]),
  body: z.string().min(1).max(10000),
  title: z.string().max(200).optional().nullable(),
  images: z.array(z.string().max(2048)).max(10).optional(),
  ctas: z.array(ctaSchema).max(5).optional(),
  rich: z.record(z.string(), z.unknown()).optional().nullable(),
  userIds: z.array(z.string().min(1).max(128)).max(5000).optional(),
  createdBy: z.string().max(200).optional().nullable()
});

const recallSchema = z.object({
  line: z.enum(["BEAM", "BEAM_MOD"]),
  mode: z.enum(["last", "last_n", "all"]),
  n: z.number().int().min(1).max(100).optional()
});

@Controller("admin/notification-campaigns")
@UseGuards(AdminAuthGuard)
export class NotificationCampaignAdminController {
  constructor(private readonly campaigns: NotificationCampaignService) {}

  /**
   * GET /admin/notification-campaigns
   */
  @Get()
  async list(
    @Query("line") line?: string,
    @Query("limit") limitRaw?: string,
    @Query("cursor") cursor?: string
  ) {
    const limit = limitRaw ? Number(limitRaw) : 50;
    const parsedLine =
      line === "BEAM" || line === "BEAM_MOD" ? (line as "BEAM" | "BEAM_MOD") : undefined;
    return this.campaigns.listCampaigns({
      line: parsedLine,
      limit: Number.isFinite(limit) ? limit : 50,
      cursor
    });
  }

  /**
   * POST /admin/notification-campaigns
   * Create and send immediately.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() body: unknown,
    @Headers("x-admin-actor") actor?: string
  ) {
    const data = createSchema.parse(body);
    return this.campaigns.createAndSend({
      line: data.line,
      body: data.body,
      title: data.title,
      images: data.images,
      ctas: data.ctas,
      rich: data.rich ?? null,
      userIds: data.userIds,
      createdBy: data.createdBy || actor || null
    });
  }

  /**
   * POST /admin/notification-campaigns/recall
   */
  @Post("recall")
  @HttpCode(HttpStatus.OK)
  async recall(@Body() body: unknown) {
    const data = recallSchema.parse(body);
    return this.campaigns.recall({
      line: data.line,
      mode: data.mode,
      n: data.n
    });
  }
}
