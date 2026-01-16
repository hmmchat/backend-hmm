import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
  HttpException,
  HttpStatus,
  Param
} from "@nestjs/common";
import { BadgeService } from "../services/badge.service.js";
import { z } from "zod";

const setBadgeSchema = z.object({
  giftId: z.string().nullable()
});

@Controller("users/:userId/badges")
export class BadgeController {
  constructor(private readonly badgeService: BadgeService) {}

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

  /**
   * Get all badges received by user
   * GET /users/:userId/badges
   */
  @Get()
  async getBadges(
    @Param("userId") userId: string,
    @Headers("authorization") authz?: string
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const authenticatedUserId = await this.verifyTokenAndGetUserId(token);
    if (authenticatedUserId !== userId) {
      throw new HttpException("Unauthorized", HttpStatus.FORBIDDEN);
    }

    // Sync badges from transactions first
    await this.badgeService.syncBadgesFromTransactions(userId);

    // Return badges
    return this.badgeService.getReceivedGifts(userId);
  }

  /**
   * Set active badge
   * POST /users/:userId/badges/active
   */
  @Post("active")
  async setActiveBadge(
    @Param("userId") userId: string,
    @Headers("authorization") authz: string,
    @Body() body: any
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const authenticatedUserId = await this.verifyTokenAndGetUserId(token);
    if (authenticatedUserId !== userId) {
      throw new HttpException("Unauthorized", HttpStatus.FORBIDDEN);
    }

    const dto = setBadgeSchema.parse(body);
    await this.badgeService.setActiveBadge(userId, dto.giftId);
    return { success: true };
  }

  /**
   * Get active badge
   * GET /users/:userId/badges/active
   */
  @Get("active")
  async getActiveBadge(
    @Param("userId") userId: string,
    @Headers("authorization") authz?: string
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const authenticatedUserId = await this.verifyTokenAndGetUserId(token);
    if (authenticatedUserId !== userId) {
      throw new HttpException("Unauthorized", HttpStatus.FORBIDDEN);
    }

    return this.badgeService.getActiveBadge(userId);
  }
}
