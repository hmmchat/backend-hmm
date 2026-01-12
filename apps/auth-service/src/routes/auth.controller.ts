import { Body, Controller, HttpException, HttpStatus, Post, Delete, Get, Headers, Param } from "@nestjs/common";
import { z } from "zod";
import { AuthService } from "../services/auth.service.js";
import { verifyToken, AccessPayload } from "@hmm/common";
import { JWK } from "jose";

const termsSchema = z.object({
  acceptedTerms: z.boolean().refine(v => v, "You must accept Terms & Conditions."),
  acceptedTermsVer: z.string().default("v1.0")
});

@Controller("auth")
export class AuthController {
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

  @Post("google")
  async google(@Body() body: any) {
    const schema = z.object({
      idToken: z.string().min(10)
    }).and(termsSchema);
    const dto = schema.parse(body);
    return this.auth.loginWithGoogle(dto.idToken, dto.acceptedTermsVer);
  }

  @Post("apple")
  async apple(@Body() body: any) {
    const schema = z.object({
      identityToken: z.string().min(10)
    }).and(termsSchema);
    const dto = schema.parse(body);
    return this.auth.loginWithApple(dto.identityToken, dto.acceptedTermsVer);
  }

  @Post("facebook")
  async facebook(@Body() body: any) {
    const schema = z.object({
      accessToken: z.string().min(10)
    }).and(termsSchema);
    const dto = schema.parse(body);
    return this.auth.loginWithFacebook(dto.accessToken, dto.acceptedTermsVer);
  }

  @Post("phone/send-otp")
  async sendOtp(@Body() body: any) {
    const { phone } = z.object({ 
      phone: z.string()
        .min(10)
        .refine((val) => val.startsWith("+91"), "Phone number must be from India (+91)")
        .refine((val) => /^\+91[6-9]\d{9}$/.test(val), "Invalid Indian phone number format. Must be +91 followed by 10 digits starting with 6-9")
    }).parse(body);
    return this.auth.sendPhoneOtp(phone);
  }

  @Post("phone/verify")
  async verifyOtp(@Body() body: any) {
    const schema = z.object({
      phone: z.string()
        .min(10)
        .refine((val) => val.startsWith("+91"), "Phone number must be from India (+91)")
        .refine((val) => /^\+91[6-9]\d{9}$/.test(val), "Invalid Indian phone number format. Must be +91 followed by 10 digits starting with 6-9"),
      code: z.string().min(4).max(8)
    }).and(termsSchema);
    const dto = schema.parse(body);
    return this.auth.verifyPhoneOtp(dto.phone, dto.code, dto.acceptedTermsVer);
  }

  @Post("refresh")
  async refresh(@Body() body: any) {
    const { refreshToken } = z.object({ refreshToken: z.string().min(20) }).parse(body);
    const result = await this.auth.refresh(refreshToken);
    if (!result) throw new HttpException("Invalid refresh token", HttpStatus.UNAUTHORIZED);
    return result;
  }

  @Post("logout")
  async logout(@Body() body: any) {
    const { refreshToken } = z.object({ refreshToken: z.string().min(20) }).parse(body);
    await this.auth.logout(refreshToken);
    return { ok: true };
  }

  /* ---------- Account Management Endpoints ---------- */

  /**
   * Deactivate account (user-initiated)
   * POST /auth/me/deactivate
   */
  @Post("me/deactivate")
  async deactivateAccount(@Headers("authorization") authz: string) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    
    await this.auth.deactivateAccount(userId);
    return { ok: true, message: "Account deactivated successfully" };
  }

  /**
   * Reactivate account (user-initiated)
   * POST /auth/me/reactivate
   */
  @Post("me/reactivate")
  async reactivateAccount(@Headers("authorization") authz: string) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    
    await this.auth.reactivateAccount(userId);
    return { ok: true, message: "Account reactivated successfully" };
  }

  /**
   * Delete account (user-initiated, soft delete)
   * DELETE /auth/me
   */
  @Delete("me")
  async deleteAccount(@Headers("authorization") authz: string) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    
    await this.auth.deleteAccount(userId);
    return { ok: true, message: "Account deletion initiated. Your data will be permanently deleted within 30 days." };
  }

  /**
   * Get account status
   * GET /auth/me/status
   */
  @Get("me/status")
  async getAccountStatus(@Headers("authorization") authz: string) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    
    return this.auth.getAccountStatus(userId);
  }

  /* ---------- Admin Endpoints (for moderation/admin use) ---------- */

  /**
   * Suspend account (admin-initiated)
   * POST /auth/admin/users/:userId/suspend
   * Note: In production, this should be protected by admin role check
   */
  @Post("admin/users/:userId/suspend")
  async suspendAccount(
    @Param("userId") userId: string,
    @Body() body: any,
    @Headers("authorization") authz?: string
  ) {
    // TODO: Add admin role verification
    const { reason } = z.object({ reason: z.string().optional() }).parse(body);
    await this.auth.suspendAccount(userId, reason);
    return { ok: true, message: `Account ${userId} suspended${reason ? `: ${reason}` : ""}` };
  }

  /**
   * Unsuspend account (admin-initiated)
   * POST /auth/admin/users/:userId/unsuspend
   */
  @Post("admin/users/:userId/unsuspend")
  async unsuspendAccount(
    @Param("userId") userId: string,
    @Headers("authorization") authz?: string
  ) {
    // TODO: Add admin role verification
    await this.auth.unsuspendAccount(userId);
    return { ok: true, message: `Account ${userId} unsuspended` };
  }

  /**
   * Ban account (admin-initiated)
   * POST /auth/admin/users/:userId/ban
   */
  @Post("admin/users/:userId/ban")
  async banAccount(
    @Param("userId") userId: string,
    @Body() body: any,
    @Headers("authorization") authz?: string
  ) {
    // TODO: Add admin role verification
    const { reason } = z.object({ reason: z.string().min(1, "Ban reason is required") }).parse(body);
    await this.auth.banAccount(userId, reason);
    return { ok: true, message: `Account ${userId} banned: ${reason}` };
  }
}