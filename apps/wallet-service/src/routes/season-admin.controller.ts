import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards
} from "@nestjs/common";
import { AdminAuthGuard } from "../guards/admin-auth.guard.js";
import { SeasonService } from "../services/season.service.js";
import { SeasonClaimStatus, SeasonTaskType } from "../../node_modules/.prisma/client/index.js";
import { z } from "zod";

const TaskSchema = z.object({
  taskType: z.nativeEnum(SeasonTaskType),
  enabled: z.boolean().optional(),
  target: z.number().int().positive().optional(),
  label: z.string().optional(),
  sortOrder: z.number().int().optional()
});

@Controller("admin/seasons")
@UseGuards(AdminAuthGuard)
export class SeasonAdminController {
  constructor(private readonly seasonService: SeasonService) {}

  @Get()
  listSeasons() {
    return this.seasonService.listSeasons();
  }

  @Get("active/summary")
  async activeSummary() {
    const active = await this.seasonService.getActiveSeason();
    if (!active) return { season: null };
    const analytics = await this.seasonService.getSeasonAnalytics(active.id);
    return analytics;
  }

  @Get(":seasonId")
  getSeason(@Param("seasonId") seasonId: string) {
    return this.seasonService.getSeason(seasonId);
  }

  @Get(":seasonId/analytics")
  analytics(@Param("seasonId") seasonId: string) {
    return this.seasonService.getSeasonAnalytics(seasonId);
  }

  @Get(":seasonId/progress")
  listProgress(
    @Param("seasonId") seasonId: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
    @Query("completedOnly") completedOnly?: string
  ) {
    return this.seasonService.listProgress(seasonId, {
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
      completedOnly: completedOnly === "true" || completedOnly === "1"
    });
  }

  @Get(":seasonId/claims")
  listClaims(
    @Param("seasonId") seasonId: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string
  ) {
    return this.seasonService.listClaims(seasonId, {
      status: status ? (status as SeasonClaimStatus) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined
    });
  }

  @Post()
  createSeason(@Body() body: any) {
    const schema = z.object({
      name: z.string().min(1),
      giftPoolSize: z.number().int().positive().optional(),
      tasks: z
        .array(
          z.object({
            taskType: z.nativeEnum(SeasonTaskType),
            enabled: z.boolean().optional(),
            target: z.number().int().positive(),
            label: z.string().min(1),
            sortOrder: z.number().int().optional()
          })
        )
        .optional()
    });
    return this.seasonService.createSeason(schema.parse(body));
  }

  @Patch(":seasonId")
  updateSeason(@Param("seasonId") seasonId: string, @Body() body: any) {
    const schema = z.object({
      name: z.string().min(1).optional(),
      giftPoolSize: z.number().int().positive().optional(),
      tasks: z.array(TaskSchema).optional()
    });
    return this.seasonService.updateSeason(seasonId, schema.parse(body));
  }

  @Post(":seasonId/start")
  startSeason(@Param("seasonId") seasonId: string) {
    return this.seasonService.startSeason(seasonId);
  }

  @Post(":seasonId/end")
  endSeason(@Param("seasonId") seasonId: string) {
    return this.seasonService.endSeason(seasonId);
  }

  @Post(":seasonId/wipe")
  wipeSeason(@Param("seasonId") seasonId: string) {
    return this.seasonService.wipeSeason(seasonId);
  }

  @Post("claims/:claimId/approve")
  approve(@Param("claimId") claimId: string) {
    return this.seasonService.approveClaim(claimId);
  }

  @Post("claims/:claimId/reject")
  reject(@Param("claimId") claimId: string, @Body() body: any) {
    const schema = z.object({
      rejectMessage: z.string().optional()
    });
    const dto = schema.parse(body || {});
    return this.seasonService.rejectClaim(claimId, dto.rejectMessage);
  }

  @Post("claims/:claimId/gift-sent")
  giftSent(@Param("claimId") claimId: string, @Body() body: any) {
    const schema = z.object({
      courierName: z.string().min(1),
      trackingNumber: z.string().min(1)
    });
    const dto = schema.parse(body);
    return this.seasonService.markGiftSent(claimId, dto.courierName, dto.trackingNumber);
  }

  @Post("claims/:claimId/gift-received")
  giftReceived(@Param("claimId") claimId: string) {
    return this.seasonService.markGiftReceived(claimId);
  }
}
