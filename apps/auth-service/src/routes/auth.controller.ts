import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Delete,
  Get,
  Headers,
  Param
} from "@nestjs/common";
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

  private assertInternalRequest(internalToken?: string) {
    const expectedToken = process.env.INTERNAL_SERVICE_TOKEN;
    if (!expectedToken) {
      throw new HttpException("INTERNAL_SERVICE_TOKEN is not configured", HttpStatus.INTERNAL_SERVER_ERROR);
    }
    if (!internalToken || internalToken !== expectedToken) {
      throw new HttpException("Unauthorized internal request", HttpStatus.UNAUTHORIZED);
    }
  }

  @Post("google")
  async google(@Body() body: any) {
    const schema = z.object({
      idToken: z.string().min(10),
      referralCode: z.string().optional()
    }).and(termsSchema);
    const dto = schema.parse(body);
    return this.auth.loginWithGoogle(dto.idToken, dto.acceptedTermsVer, dto.referralCode);
  }

  @Post("apple")
  async apple(@Body() body: any) {
    const schema = z.object({
      identityToken: z.string().min(10),
      referralCode: z.string().optional()
    }).and(termsSchema);
    const dto = schema.parse(body);
    return this.auth.loginWithApple(dto.identityToken, dto.acceptedTermsVer, dto.referralCode);
  }

  @Post("facebook")
  async facebook(@Body() body: any) {
    const schema = z.object({
      accessToken: z.string().min(10),
      referralCode: z.string().optional()
    }).and(termsSchema);
    const dto = schema.parse(body);
    return this.auth.loginWithFacebook(dto.accessToken, dto.acceptedTermsVer, dto.referralCode);
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
      code: z.string().min(4).max(8),
      referralCode: z.string().optional()
    }).and(termsSchema);
    const dto = schema.parse(body);
    return this.auth.verifyPhoneOtp(dto.phone, dto.code, dto.acceptedTermsVer, dto.referralCode);
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
   * List users for admin dashboards
   * GET /auth/admin/users
   */
  @Get("admin/users")
  async listAdminUsers() {
    return this.auth.listUsersForAdminDashboard();
  }

  /**
   * Single auth user for admin dashboards (merged with profile in user-service).
   * GET /auth/admin/users/:userId
   */
  @Get("admin/users/:userId")
  async getAdminUser(@Param("userId") userId: string) {
    return this.auth.getUserForAdminDashboard(userId);
  }

  /**
   * Suspend account (admin-initiated)
   * POST /auth/admin/users/:userId/suspend
   * Note: In production, this should be protected by admin role check
   */
  @Post("admin/users/:userId/suspend")
  async suspendAccount(
    @Param("userId") userId: string,
    @Body() body: any,
    @Headers("authorization") _authz?: string
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
    @Headers("authorization") _authz?: string
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
    @Headers("authorization") _authz?: string
  ) {
    // TODO: Add admin role verification
    const { reason, reportAutoBan } = z
      .object({
        reason: z.string().optional(),
        reportAutoBan: z.boolean().optional()
      })
      .parse(body ?? {});
    const finalReason = (reason && String(reason).trim()) || "Moderation action";
    await this.auth.banAccount(userId, finalReason, { reportAutoBan: reportAutoBan === true });
    return { ok: true, message: `Account ${userId} banned: ${finalReason}` };
  }

  /**
   * Unban account (admin-initiated)
   * POST /auth/admin/users/:userId/unban
   */
  @Post("admin/users/:userId/unban")
  async unbanAccount(@Param("userId") userId: string, @Headers("authorization") _authz?: string) {
    await this.auth.unbanAccount(userId);
    return { ok: true, message: `Account ${userId} unbanned` };
  }

  /**
   * Restore login when report score drops below threshold (user-service internal).
   * POST /auth/admin/users/:userId/lift-report-auto-ban
   */
  @Post("admin/users/:userId/lift-report-auto-ban")
  @HttpCode(HttpStatus.OK)
  async liftReportAutoBan(@Param("userId") userId: string, @Headers("authorization") _authz?: string) {
    const res = await this.auth.liftReportAutoBanIfApplicable(userId);
    return { ok: true, ...res };
  }

  /**
   * Deactivate account (admin / dashboard) — same state as user self-deactivate; user may reactivate in app.
   * POST /auth/admin/users/:userId/deactivate
   */
  @Post("admin/users/:userId/deactivate")
  @HttpCode(HttpStatus.OK)
  async adminDeactivateUser(@Param("userId") userId: string, @Headers("authorization") _authz?: string) {
    await this.auth.deactivateAccount(userId);
    return { ok: true, message: `Account ${userId} deactivated` };
  }

  /**
   * Restore login for DEACTIVATED or legacy SUSPENDED — not for BANNED (use unban).
   * POST /auth/admin/users/:userId/restore-login
   */
  @Post("admin/users/:userId/restore-login")
  @HttpCode(HttpStatus.OK)
  async adminRestoreLogin(@Param("userId") userId: string, @Headers("authorization") _authz?: string) {
    await this.auth.adminRestoreLoginAccess(userId);
    return { ok: true, message: `Login access restored for ${userId}` };
  }

  /**
   * Permanently delete auth user row (dashboard hard delete).
   * DELETE /auth/admin/users/:userId
   */
  @Delete("admin/users/:userId")
  @HttpCode(HttpStatus.OK)
  async adminHardDeleteUser(@Param("userId") userId: string, @Headers("authorization") _authz?: string) {
    await this.auth.adminHardDeleteUser(userId);
    return { ok: true, message: `Account ${userId} removed from auth` };
  }

  /* ---------- Referral Endpoints ---------- */

  /**
   * Get referral status for a user (internal endpoint for user-service)
   * GET /auth/users/:userId/referral-status
   */
  @Get("users/:userId/referral-status")
  async getReferralStatus(@Param("userId") userId: string, @Headers("x-internal-token") internalToken?: string) {
    this.assertInternalRequest(internalToken);
    return this.auth.getReferralStatus(userId);
  }

  /**
   * Get account status for a user (internal endpoint for user-service)
   * GET /auth/users/:userId/account-status
   */
  @Get("users/:userId/account-status")
  async getAccountStatusForUser(@Param("userId") userId: string, @Headers("x-internal-token") internalToken?: string) {
    this.assertInternalRequest(internalToken);
    return this.auth.getAccountStatus(userId);
  }

  /**
   * Mark referral reward as claimed (internal endpoint for user-service)
   * POST /auth/users/:userId/mark-referral-claimed
   */
  @Post("users/:userId/mark-referral-claimed")
  async markReferralClaimed(@Param("userId") userId: string, @Headers("x-internal-token") internalToken?: string) {
    this.assertInternalRequest(internalToken);
    await this.auth.markReferralClaimed(userId);
    return { ok: true };
  }

  /**
   * Get current user's referral code
   * GET /auth/me/referral-code
   */
  @Get("me/referral-code")
  async getMyReferralCode(@Headers("authorization") authz: string) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    const referralCode = await this.auth.getReferralCode(userId);
    return { referralCode };
  }

  /**
   * Get list of users referred by current user
   * GET /auth/me/referrals
   */
  @Get("me/referrals")
  async getMyReferrals(@Headers("authorization") authz: string) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    return this.auth.getReferrals(userId);
  }

  /**
   * Get referral statistics
   * GET /auth/me/referral-stats
   */
  @Get("me/referral-stats")
  async getMyReferralStats(@Headers("authorization") authz: string) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    return this.auth.getReferralStats(userId);
  }
}