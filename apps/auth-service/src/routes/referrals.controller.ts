import { Body, Controller, Get, Headers, HttpException, HttpStatus, Post } from "@nestjs/common";
import { z } from "zod";
import { verifyToken, AccessPayload } from "@hmm/common";
import { JWK } from "jose";
import { AuthService } from "../services/auth.service.js";

const ShareEventSchema = z.object({
  channel: z.enum(["whatsapp", "instagram", "snapchat", "copy", "other"]),
  target: z.string().optional(),
  metadata: z.record(z.any()).optional()
});

@Controller("referrals")
export class ReferralsController {
  private verifyAccess!: (token: string) => Promise<AccessPayload>;
  private publicJwk!: JWK;
  private jwtInitialized = false;

  constructor(private readonly auth: AuthService) {}

  private async initializeJWT() {
    if (this.jwtInitialized) return;

    const jwkStr = process.env.JWT_PUBLIC_JWK;
    if (!jwkStr || jwkStr === "undefined") {
      throw new Error("JWT_PUBLIC_JWK environment variable is not set or is invalid");
    }

    const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
    this.publicJwk = JSON.parse(cleanedJwk) as JWK;
    this.verifyAccess = await verifyToken(this.publicJwk);
    this.jwtInitialized = true;
  }

  private getTokenFromHeader(h?: string): string | null {
    if (!h) return null;
    const [t, v] = h.split(" ");
    return t?.toLowerCase() === "bearer" ? v : null;
  }

  private async verifyTokenAndGetUserId(token: string): Promise<string> {
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }
    await this.initializeJWT();
    const payload = await this.verifyAccess(token);
    return payload.sub;
  }

  @Get("me/overview")
  async getMyReferralOverview(@Headers("authorization") authz: string) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    return this.auth.getReferralOverview(userId);
  }

  @Post("me/share-events")
  async trackShareEvent(@Headers("authorization") authz: string, @Body() body: unknown) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    const dto = ShareEventSchema.parse(body);
    await this.auth.trackReferralShareEvent(userId, dto);
    return { ok: true };
  }
}
