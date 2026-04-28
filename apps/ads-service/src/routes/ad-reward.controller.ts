import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
  Query,
  HttpException,
  HttpStatus
} from "@nestjs/common";
import { AdRewardService } from "../services/ad-reward.service.js";
import { AdRewardConfigService } from "../config/ad-reward.config.js";
import { z } from "zod";

const VerifyAdRewardSchema = z.object({
  adUnitId: z.string().min(1, "adUnitId is required"),
  adNetwork: z.string().optional(),
  providerTransactionId: z.string().min(1).optional(),
  rewardToken: z.string().min(1).optional(),
  rewardSignature: z.string().min(1).optional(),
  revenue: z.number().nonnegative().optional(),
  eCPM: z.number().nonnegative().optional()
});

const UpdateConfigSchema = z.object({
  coinsPerAd: z.number().positive().optional(),
  isActive: z.boolean().optional(),
  minCooldown: z.number().positive().optional(),
  maxAdsPerDay: z.number().positive().nullable().optional()
});

@Controller()
export class AdRewardController {
  constructor(
    private readonly adRewardService: AdRewardService,
    private readonly configService: AdRewardConfigService
  ) {}

  private getTokenFromHeader(h?: string) {
    if (!h) return null;
    const [t, v] = h.split(" ");
    return t?.toLowerCase() === "bearer" ? v : null;
  }

  private async verifyTokenAndGetUserId(token: string): Promise<string> {
    const { verifyToken } = await import("@hmm/common");
    const jwkStr = process.env.JWT_PUBLIC_JWK;
    if (!jwkStr || jwkStr === "undefined") {
      throw new HttpException("Server configuration error", HttpStatus.INTERNAL_SERVER_ERROR);
    }
    const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
    const publicJwk = JSON.parse(cleanedJwk);
    const verifyAccess = await verifyToken(publicJwk);
    const payload = await verifyAccess(token);
    return payload.sub;
  }

  private assertInternalRequest(internalToken?: string) {
    const expectedToken = this.configService.getInternalServiceToken();
    if (!expectedToken) {
      throw new HttpException("INTERNAL_SERVICE_TOKEN is not configured", HttpStatus.INTERNAL_SERVER_ERROR);
    }
    if (!internalToken || internalToken !== expectedToken) {
      throw new HttpException("Unauthorized internal request", HttpStatus.UNAUTHORIZED);
    }
  }

  private assertTestEndpointsEnabled() {
    if (!this.configService.areTestEndpointsEnabled()) {
      throw new HttpException("Test endpoints are disabled", HttpStatus.NOT_FOUND);
    }
  }

  /**
   * Verify ad completion and award coins
   * POST /me/ads/reward/verify
   */
  @Post("me/ads/reward/verify")
  async verifyAdReward(
    @Headers("authorization") authz: string,
    @Body() body: any
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const userId = await this.verifyTokenAndGetUserId(token);
    const dto = VerifyAdRewardSchema.parse(body);

    try {
      return await this.adRewardService.verifyAndAwardReward({
        userId,
        adUnitId: dto.adUnitId,
        adNetwork: dto.adNetwork,
        providerTransactionId: dto.providerTransactionId,
        rewardToken: dto.rewardToken,
        rewardSignature: dto.rewardSignature,
        revenue: dto.revenue,
        eCPM: dto.eCPM
      });
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error instanceof Error ? error.message : "Failed to verify ad reward",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Get user's ad reward history
   * GET /me/ads/reward/history
   */
  @Get("me/ads/reward/history")
  async getRewardHistory(
    @Headers("authorization") authz: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const userId = await this.verifyTokenAndGetUserId(token);
    const limitNum = limit ? parseInt(limit, 10) : 50;
    const offsetNum = offset ? parseInt(offset, 10) : 0;

    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      throw new HttpException("Limit must be between 1 and 100", HttpStatus.BAD_REQUEST);
    }

    if (isNaN(offsetNum) || offsetNum < 0) {
      throw new HttpException("Offset must be non-negative", HttpStatus.BAD_REQUEST);
    }

    return this.adRewardService.getRewardHistory(userId, limitNum, offsetNum);
  }

  /**
   * Get current reward configuration
   * GET /ads/reward/config
   */
  @Get("ads/reward/config")
  async getRewardConfig() {
    return this.adRewardService.getRewardConfig();
  }

  /**
   * Update reward configuration (Admin only - should add admin auth check)
   * POST /ads/reward/config
   */
  @Post("ads/reward/config")
  async updateRewardConfig(@Body() body: any, @Headers("x-internal-token") internalToken?: string) {
    this.assertInternalRequest(internalToken);
    const dto = UpdateConfigSchema.parse(body);

    return this.adRewardService.updateRewardConfig(
      dto.coinsPerAd,
      dto.isActive,
      dto.minCooldown,
      dto.maxAdsPerDay
    );
  }

  /* ---------- Test Endpoints (No Auth Required) ---------- */

  /**
   * Test endpoint: Verify ad reward (bypasses auth)
   * POST /test/ads/reward/verify
   * Body: { userId: string, adUnitId: string, adNetwork?: string }
   */
  @Post("test/ads/reward/verify")
  async verifyAdRewardTest(@Body() body: any) {
    this.assertTestEndpointsEnabled();
    const dto = VerifyAdRewardSchema.extend({
      userId: z.string().min(1)
    }).parse(body);
    const { userId, adUnitId } = dto;
    if (!userId || !adUnitId) {
      throw new HttpException("userId and adUnitId are required", HttpStatus.BAD_REQUEST);
    }

    try {
      return await this.adRewardService.verifyAndAwardReward(dto);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error instanceof Error ? error.message : "Failed to verify ad reward",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Test endpoint: Get reward history (bypasses auth)
   * GET /test/ads/reward/history?userId=xxx&limit=50&offset=0
   */
  @Get("test/ads/reward/history")
  async getRewardHistoryTest(
    @Query("userId") userId: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string
  ) {
    this.assertTestEndpointsEnabled();
    if (!userId) {
      throw new HttpException("userId is required", HttpStatus.BAD_REQUEST);
    }

    const limitNum = limit ? parseInt(limit, 10) : 50;
    const offsetNum = offset ? parseInt(offset, 10) : 0;

    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      throw new HttpException("Limit must be between 1 and 100", HttpStatus.BAD_REQUEST);
    }

    if (isNaN(offsetNum) || offsetNum < 0) {
      throw new HttpException("Offset must be non-negative", HttpStatus.BAD_REQUEST);
    }

    return this.adRewardService.getRewardHistory(userId, limitNum, offsetNum);
  }
}
