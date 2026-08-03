import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
  HttpException,
  HttpStatus
} from "@nestjs/common";
import { SeasonService } from "../services/season.service.js";
import { z } from "zod";

const ClaimSchema = z.object({
  recipientName: z.string().min(1),
  phone: z.string().min(10),
  addressLine1: z.string().min(1),
  addressLine2: z.string().optional().nullable(),
  addressLine3: z.string().optional().nullable(),
  landmark: z.string().optional().nullable(),
  state: z.string().min(1),
  city: z.string().min(1),
  pincode: z.string().min(6).max(6)
});

@Controller()
export class SeasonController {
  constructor(private readonly seasonService: SeasonService) {}

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
    const expectedToken = process.env.INTERNAL_SERVICE_TOKEN;
    if (!expectedToken) {
      throw new HttpException("INTERNAL_SERVICE_TOKEN is not configured", HttpStatus.INTERNAL_SERVER_ERROR);
    }
    if (!internalToken || internalToken !== expectedToken) {
      throw new HttpException("Unauthorized internal request", HttpStatus.UNAUTHORIZED);
    }
  }

  /**
   * GET /me/season — Mystery Beam Box state for current user
   */
  @Get("me/season")
  async getMySeason(@Headers("authorization") authz?: string) {
    const token = this.getTokenFromHeader(authz);
    if (!token) throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    const userId = await this.verifyTokenAndGetUserId(token);
    return this.seasonService.getMySeasonView(userId);
  }

  /**
   * POST /me/season/claim — Ship it (submit / resubmit address)
   */
  @Post("me/season/claim")
  async submitClaim(@Headers("authorization") authz: string, @Body() body: any) {
    const token = this.getTokenFromHeader(authz);
    if (!token) throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    const userId = await this.verifyTokenAndGetUserId(token);
    const dto = ClaimSchema.parse(body);
    return this.seasonService.submitClaim(userId, dto);
  }

  /* ---------- Internal (streaming-service) ---------- */

  /**
   * POST /internal/season/peers
   * Body: { userId, peerUserId } or { pairs: [{userId, peerUserId}] }
   */
  @Post("internal/season/peers")
  async recordPeers(@Body() body: any, @Headers("x-internal-token") internalToken?: string) {
    this.assertInternalRequest(internalToken);

    if (Array.isArray(body?.pairs)) {
      const results = [];
      for (const p of body.pairs) {
        results.push(await this.seasonService.recordPeerEncounter(p.userId, p.peerUserId));
      }
      return { results };
    }

    const schema = z.object({
      userId: z.string().min(1),
      peerUserId: z.string().min(1)
    });
    const dto = schema.parse(body);
    return this.seasonService.recordPeerEncounter(dto.userId, dto.peerUserId);
  }

  /**
   * POST /internal/season/call-time
   * Body: { userId, beamSeconds?, beamcastSeconds?, eventKey }
   */
  @Post("internal/season/call-time")
  async creditCallTime(@Body() body: any, @Headers("x-internal-token") internalToken?: string) {
    this.assertInternalRequest(internalToken);
    const schema = z.object({
      userId: z.string().min(1),
      beamSeconds: z.number().int().nonnegative().optional(),
      beamcastSeconds: z.number().int().nonnegative().optional(),
      eventKey: z.string().min(1)
    });
    const dto = schema.parse(body);
    return this.seasonService.creditCallTime(dto);
  }

  /**
   * POST /internal/season/peers/backfill
   * Body: { pairs: [{ userId, peerUserId }] }
   */
  @Post("internal/season/peers/backfill")
  async backfillPeers(@Body() body: any, @Headers("x-internal-token") internalToken?: string) {
    this.assertInternalRequest(internalToken);
    const schema = z.object({
      pairs: z.array(
        z.object({
          userId: z.string().min(1),
          peerUserId: z.string().min(1)
        })
      )
    });
    const dto = schema.parse(body);
    return this.seasonService.upsertPeerPairs(dto.pairs);
  }
}
