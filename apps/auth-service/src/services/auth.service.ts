// @ts-nocheck — Prisma client types lag schema until `prisma generate` is run with the workspace Prisma version.
import { Injectable, OnModuleInit, HttpException, HttpStatus } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

import { ProviderGoogle } from "./providers/google.provider.js";
import { ProviderApple } from "./providers/apple.provider.js";
import { ProviderFacebook } from "./providers/facebook.provider.js";
import { ProviderPhone } from "./providers/phone.provider.js";

import {
  signAccessToken,
  signRefreshToken
} from "@hmm/common";

import * as argon2 from "argon2";

@Injectable()
export class AuthService implements OnModuleInit {
  private privateKey!: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly google: ProviderGoogle,
    private readonly apple: ProviderApple,
    private readonly facebook: ProviderFacebook,
    private readonly phone: ProviderPhone
  ) {}

  /* ---------- Init ---------- */

  async onModuleInit() {
    // Load JWT private key from environment variable
    const keyStr = process.env.JWT_PRIVATE_KEY;

    if (!keyStr || keyStr === "undefined") {
      throw new Error("JWT_PRIVATE_KEY environment variable is not set or is invalid");
    }

    // Remove surrounding quotes if present
    this.privateKey = keyStr.trim().replace(/^['"]|['"]$/g, "");
  }

  /* ---------- Auth flows ---------- */

  async loginWithGoogle(idToken: string, termsVer: string, referralCode?: string) {
    const g = await this.google.verify(idToken);
    return this.signInOrUp(
      {
        email: g.email,
        googleSub: g.sub
      },
      termsVer,
      referralCode
    );
  }

  async loginWithApple(identityToken: string, termsVer: string, referralCode?: string) {
    const a = await this.apple.verify(identityToken);
    return this.signInOrUp(
      {
        email: a.email,
        appleSub: a.sub
      },
      termsVer,
      referralCode
    );
  }

  async loginWithFacebook(accessToken: string, termsVer: string, referralCode?: string) {
    const f = await this.facebook.verify(accessToken);
    return this.signInOrUp(
      {
        email: f.email,
        facebookId: f.id
      },
      termsVer,
      referralCode
    );
  }

  async sendPhoneOtp(phone: string) {
    try {
      await this.phone.send(phone);
      return { ok: true };
    } catch (err) {
      throw new HttpException(
        err instanceof Error ? err.message : "Failed to send OTP",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async verifyPhoneOtp(phone: string, code: string, termsVer: string, referralCode?: string) {
    await this.phone.verify(phone, code);
    return this.signInOrUp({ phone }, termsVer, referralCode);
  }

  /* ---------- Tokens ---------- */

  async refresh(refreshToken: string) {
    const sessions = await this.prisma.session.findMany({
      where: { expiresAt: { gt: new Date() } }
    });

    for (const session of sessions) {
      const valid = await argon2.verify(session.refreshHash, refreshToken);
      if (!valid) continue;

      const accessToken = await signAccessToken(this.privateKey, {
        sub: session.userId,
        uid: session.userId
      });

      return { accessToken };
    }

    return null;
  }

  async logout(refreshToken: string) {
    const sessions = await this.prisma.session.findMany({
      where: { expiresAt: { gt: new Date() } }
    });

    for (const session of sessions) {
      const valid = await argon2.verify(session.refreshHash, refreshToken);
      if (!valid) continue;

      await this.prisma.session.delete({ where: { id: session.id } });
      return;
    }
  }

  /* ---------- Internal ---------- */

  /**
   * Blocked sign-in messages — keep in sync with product copy (dashboard ban / user deactivate / closed account).
   */
  private assertUserCanSignIn(user: {
    accountStatus: string;
    deletedAt: Date | null;
    banReason: string | null;
    suspensionReason: string | null;
    reportAutoBanActive?: boolean | null;
    reportBanNoLoginUntil?: Date | null;
  }): void {
    if (user.deletedAt) {
      throw new HttpException(
        "This account is no longer available.",
        HttpStatus.FORBIDDEN
      );
    }
    if (user.accountStatus === "BANNED") {
      const auto = Boolean(user.reportAutoBanActive);
      const noLoginUntil = user.reportBanNoLoginUntil ? new Date(user.reportBanNoLoginUntil) : null;
      if (auto && noLoginUntil && Date.now() < noLoginUntil.getTime()) {
        throw new HttpException(
          `Your account has been restricted due to repeated reports. You cannot sign in until ${noLoginUntil.toISOString()}. After that you may sign in with limited access until a moderator reviews your account.`,
          HttpStatus.FORBIDDEN
        );
      }
      const base =
        "Your account has been deactivated by an administrator. You cannot sign in until an administrator restores your account (unban).";
      throw new HttpException(
        user.banReason ? `${base} Details: ${user.banReason}` : base,
        HttpStatus.FORBIDDEN
      );
    }
    if (user.accountStatus === "DEACTIVATED") {
      throw new HttpException(
        "Your account is deactivated. Open the Beam app and use Activate account to sign in again.",
        HttpStatus.FORBIDDEN
      );
    }
    if (user.accountStatus === "SUSPENDED") {
      const base = "Your account is suspended. Please contact support.";
      throw new HttpException(
        user.suspensionReason ? `${base} Details: ${user.suspensionReason}` : base,
        HttpStatus.FORBIDDEN
      );
    }
    if (user.accountStatus !== "ACTIVE") {
      throw new HttpException("Account is not active.", HttpStatus.FORBIDDEN);
    }
  }

  private async signInOrUp(
    data: Partial<{
      email: string | null;
      phone: string | null;
      googleSub: string | null;
      appleSub: string | null;
      facebookId: string | null;
    }>,
    termsVer: string,
    referralCode?: string
  ) {
    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [
          data.googleSub && { googleSub: data.googleSub },
          data.appleSub && { appleSub: data.appleSub },
          data.facebookId && { facebookId: data.facebookId },
          data.email && { email: data.email },
          data.phone && { phone: data.phone }
        ].filter(Boolean) as any
      }
    });

    const isNewUser = !existingUser;
    let user = existingUser;

    if (isNewUser) {
      // Handle referral code for new users only
      let referredBy: string | null = null;
      
      if (referralCode) {
        try {
          // Find referrer by referral code
          const referrer = await this.prisma.user.findUnique({
            where: { referralCode },
            select: { id: true, accountStatus: true }
          });

          if (referrer && referrer.accountStatus === "ACTIVE" && referrer.id) {
            referredBy = referrer.id;
            console.log(JSON.stringify({
              event: "referral_code_accepted",
              referralCode,
              referrerId: referrer.id,
              ts: new Date().toISOString()
            }));
          } else {
            console.log(JSON.stringify({
              event: "referral_code_rejected",
              referralCode,
              reason: referrer ? "inactive_referrer" : "code_not_found",
              ts: new Date().toISOString()
            }));
          }
          // If referrer not found or inactive, silently ignore (don't block signup)
        } catch (error) {
          // Log error but don't block signup
          console.error("Error processing referral code:", error);
        }
      }

      // Generate referral code for new user
      const newReferralCode = await this.generateUniqueReferralCode();

      user = await this.prisma.user.create({
        data: {
          email: data.email ?? undefined,
          phone: data.phone ?? undefined,
          googleSub: data.googleSub ?? undefined,
          appleSub: data.appleSub ?? undefined,
          facebookId: data.facebookId ?? undefined,
          acceptedTerms: true,
          acceptedTermsAt: new Date(),
          acceptedTermsVer: termsVer,
          referralCode: newReferralCode,
          referredBy: referredBy ?? undefined
        }
      });

      // Create referral record if referredBy is set
      // Prevent self-referral: check if referrer is the same as the new user
      if (referredBy && referredBy !== user.id) {
        try {
          await this.prisma.referral.create({
            data: {
              referrerId: referredBy,
              referredUserId: user.id,
              rewardClaimed: false
            }
          });
        } catch (error) {
          // Log error but don't block signup
          console.error("Error creating referral record:", error);
        }
      } else if (referredBy && referredBy === user.id) {
        // Self-referral detected - clear referredBy and log warning
        console.warn(`Self-referral attempt detected for user ${user.id}, ignoring referral code`);
        await this.prisma.user.update({
          where: { id: user.id },
          data: { referredBy: null }
        });
      }
    } else {
      user = existingUser;
    }

    // Report auto-ban: after login lockout ends, restore ACTIVE so the user can sign in; discovery stays limited via user-service (reportModeratorCardsOnly).
    if (
      user &&
      user.accountStatus === "BANNED" &&
      user.reportAutoBanActive &&
      user.reportBanNoLoginUntil &&
      new Date() >= new Date(user.reportBanNoLoginUntil)
    ) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          accountStatus: "ACTIVE",
          bannedAt: null,
          banReason: null,
          reportAutoBanActive: false,
          reportBanNoLoginUntil: null
        }
      });
    }

    this.assertUserCanSignIn(user);

    const accessToken = await signAccessToken(this.privateKey, {
      sub: user.id,
      uid: user.id
    });

    const refreshToken = await signRefreshToken(this.privateKey, {
      sub: user.id,
      uid: user.id
    });

    const refreshExpiryDays = parseInt(process.env.REFRESH_TOKEN_EXPIRY_DAYS || "30", 10);
    await this.prisma.session.create({
      data: {
        userId: user.id,
        refreshHash: await argon2.hash(refreshToken),
        expiresAt: new Date(Date.now() + refreshExpiryDays * 24 * 60 * 60 * 1000)
      }
    });

    return { accessToken, refreshToken };
  }

  /* ---------- Referral Management ---------- */

  /**
   * Generate a unique referral code
   */
  private async generateUniqueReferralCode(): Promise<string> {
    let code = "";
    let isUnique = false;
    let attempts = 0;
    const maxAttempts = parseInt(process.env.REFERRAL_CODE_MAX_GENERATION_ATTEMPTS || "10", 10);

    while (!isUnique && attempts < maxAttempts) {
      // Generate a short, user-friendly code (8 characters, alphanumeric uppercase)
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Exclude confusing chars like 0, O, I, 1
      code = "";
      for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }

      const existing = await this.prisma.user.findUnique({
        where: { referralCode: code },
        select: { id: true }
      });

      if (!existing) {
        isUnique = true;
      }
      attempts++;
    }

    if (!isUnique) {
      // Fallback: use timestamp + random string if we can't generate a unique short code
      code = `REF${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    }

    return code;
  }

  /**
   * Get referral status for a user (for user-service to check)
   */
  async getReferralStatus(userId: string): Promise<{
    referredBy: string | null;
    referralRewardClaimed: boolean;
    referralCode: string;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        referredBy: true,
        referralRewardClaimed: true,
        referralCode: true
      }
    });

    if (!user) {
      throw new HttpException("User not found", HttpStatus.NOT_FOUND);
    }

    // Generate referral code if it doesn't exist (for existing users)
    let referralCode = user.referralCode;
    if (!referralCode) {
      referralCode = await this.generateUniqueReferralCode();
      await this.prisma.user.update({
        where: { id: userId },
        data: { referralCode }
      });
    }

    return {
      referredBy: user.referredBy,
      referralRewardClaimed: user.referralRewardClaimed ?? false,
      referralCode
    };
  }

  /**
   * Mark referral reward as claimed (called by user-service after awarding rewards)
   */
  async markReferralClaimed(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { referredBy: true }
    });

    if (!user) {
      throw new HttpException("User not found", HttpStatus.NOT_FOUND);
    }

    if (!user.referredBy) {
      return; // No referral to mark as claimed
    }

    // Update user's referralRewardClaimed flag
    await this.prisma.user.update({
      where: { id: userId },
      data: { referralRewardClaimed: true }
    });

    // Update referral record
    await this.prisma.referral.updateMany({
      where: {
        referredUserId: userId,
        rewardClaimed: false
      },
      data: {
        rewardClaimed: true,
        claimedAt: new Date()
      }
    });
  }

  /**
   * Get user's referral code
   */
  async getReferralCode(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true }
    });

    if (!user) {
      throw new HttpException("User not found", HttpStatus.NOT_FOUND);
    }

    // Generate referral code if it doesn't exist (for existing users)
    if (!user.referralCode) {
      const referralCode = await this.generateUniqueReferralCode();
      await this.prisma.user.update({
        where: { id: userId },
        data: { referralCode }
      });
      return referralCode;
    }

    return user.referralCode;
  }

  /**
   * Get list of users referred by current user
   */
  async getReferrals(userId: string): Promise<Array<{
    id: string;
    referredUserId: string;
    rewardClaimed: boolean;
    claimedAt: Date | null;
    createdAt: Date;
  }>> {
    const referrals = await this.prisma.referral.findMany({
      where: { referrerId: userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        referredUserId: true,
        rewardClaimed: true,
        claimedAt: true,
        createdAt: true
      }
    });

    return referrals;
  }

  /**
   * Get referral statistics
   */
  async getReferralStats(userId: string): Promise<{
    totalReferred: number;
    rewardsClaimed: number;
    pendingRewards: number;
  }> {
    const referrals = await this.prisma.referral.findMany({
      where: { referrerId: userId }
    });

    return {
      totalReferred: referrals.length,
      rewardsClaimed: referrals.filter(r => r.rewardClaimed).length,
      pendingRewards: referrals.filter(r => !r.rewardClaimed).length
    };
  }

  async getReferralOverview(userId: string): Promise<{
    referralCode: string;
    rewardConfig: {
      referrerCoins: number;
      referredCoins: number;
      successCriteriaLabel: string;
    };
    share: {
      deepLink: string;
      messageTemplate: string;
      copyText: string;
      code: string;
    };
    stats: {
      totalReferred: number;
      successfulReferrals: number;
      pendingReferrals: number;
      totalCoinsEarned: number;
    };
    recentReferrals: Array<{
      referredUserId: string;
      status: "joined" | "rewarded";
      createdAt: Date;
      claimedAt: Date | null;
    }>;
  }> {
    const [referralCode, stats, referrals] = await Promise.all([
      this.getReferralCode(userId),
      this.getReferralStats(userId),
      this.getReferrals(userId)
    ]);

    const referrerCoins = parseInt(process.env.REFERRAL_REWARD_REFERRER || "100", 10);
    const referredCoins = parseInt(process.env.REFERRAL_REWARD_REFERRED || "50", 10);
    const successCriteriaLabel = process.env.REFERRAL_SUCCESS_CRITERIA_LABEL || "Profile completed";
    // Production should set REFERRAL_SHARE_BASE_URL explicitly if this default is wrong.
    const baseUrl =
      process.env.REFERRAL_SHARE_BASE_URL || "https://sandbox.rbshstudio.com";
    const paramName = process.env.REFERRAL_SHARE_QUERY_PARAM || "ref";
    const separator = baseUrl.includes("?") ? "&" : "?";
    const deepLink = `${baseUrl}${separator}${encodeURIComponent(paramName)}=${encodeURIComponent(referralCode)}`;
    const rawTemplate = process.env.REFERRAL_SHARE_TEMPLATE
      || "Join me on Beam! Use my referral code {code} and get rewards: {link}";

    const messageTemplate = rawTemplate
      .replaceAll("{code}", referralCode)
      .replaceAll("{link}", deepLink)
      .replaceAll("{referrerCoins}", String(referrerCoins))
      .replaceAll("{referredCoins}", String(referredCoins));

    const recentReferrals = referrals.slice(0, 20).map((referral) => ({
      referredUserId: referral.referredUserId,
      status: referral.rewardClaimed ? "rewarded" as const : "joined" as const,
      createdAt: referral.createdAt,
      claimedAt: referral.claimedAt
    }));

    return {
      referralCode,
      rewardConfig: {
        referrerCoins,
        referredCoins,
        successCriteriaLabel
      },
      share: {
        deepLink,
        messageTemplate,
        copyText: deepLink,
        code: referralCode
      },
      stats: {
        totalReferred: stats.totalReferred,
        successfulReferrals: stats.rewardsClaimed,
        pendingReferrals: stats.pendingRewards,
        totalCoinsEarned: stats.rewardsClaimed * referrerCoins
      },
      recentReferrals
    };
  }

  async trackReferralShareEvent(
    userId: string,
    payload: {
      channel: "whatsapp" | "instagram" | "snapchat" | "copy" | "other";
      target?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<void> {
    console.log(JSON.stringify({
      event: "referral_share_event",
      userId,
      channel: payload.channel,
      target: payload.target || null,
      metadata: payload.metadata || null,
      ts: new Date().toISOString()
    }));
  }

  /* ---------- Account Management ---------- */

  /**
   * Deactivate user account (user-initiated)
   * Sets accountStatus to DEACTIVATED and deactivatedAt timestamp
   */
  async deactivateAccount(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        accountStatus: "DEACTIVATED",
        deactivatedAt: new Date()
      }
    });

    // Delete all active sessions
    await this.prisma.session.deleteMany({
      where: { userId }
    });
  }

  /**
   * Reactivate user account (user-initiated, app only).
   * Only DEACTIVATED accounts may be reactivated here — not BANNED (admin must unban).
   */
  async reactivateAccount(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { accountStatus: true }
    });
    if (!user) {
      throw new HttpException("User not found", HttpStatus.NOT_FOUND);
    }
    if (user.accountStatus !== "DEACTIVATED") {
      throw new HttpException(
        "Only a deactivated account can be reactivated from the app. If an administrator restricted your account, use support or wait for unban.",
        HttpStatus.BAD_REQUEST
      );
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        accountStatus: "ACTIVE",
        deactivatedAt: null
      }
    });
  }

  /**
   * Suspend user account (admin-initiated)
   * Sets accountStatus to SUSPENDED with optional reason
   */
  async suspendAccount(userId: string, reason?: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        accountStatus: "SUSPENDED",
        suspendedAt: new Date(),
        suspensionReason: reason || null
      }
    });

    // Delete all active sessions
    await this.prisma.session.deleteMany({
      where: { userId }
    });
  }

  /**
   * Unsuspend user account (admin-initiated)
   * Sets accountStatus back to ACTIVE
   */
  async unsuspendAccount(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        accountStatus: "ACTIVE",
        suspendedAt: null,
        suspensionReason: null
      }
    });
  }

  /**
   * Ban user account (admin / dashboard only). Reversible via unbanAccount.
   * User cannot sign in until an administrator unbans.
   */
  async banAccount(userId: string, reason: string, opts?: { reportAutoBan?: boolean }): Promise<void> {
    const reportAutoBan = Boolean(opts?.reportAutoBan);
    let reportBanNoLoginUntil: Date | null = null;
    if (reportAutoBan) {
      const days = parseInt(process.env.REPORT_BAN_LOGIN_BLOCK_DAYS || "7", 10);
      const effectiveDays = Number.isNaN(days) || days < 1 ? 7 : Math.min(days, 365);
      reportBanNoLoginUntil = new Date(Date.now() + effectiveDays * 24 * 60 * 60 * 1000);
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        accountStatus: "BANNED",
        bannedAt: new Date(),
        banReason: reason,
        reportAutoBanActive: reportAutoBan,
        reportBanNoLoginUntil: reportAutoBan ? reportBanNoLoginUntil : null
      }
    });

    // Delete all active sessions
    await this.prisma.session.deleteMany({
      where: { userId }
    });
  }

  /**
   * If the user was banned only by the report auto-flow, restore ACTIVE (e.g. report score lowered below threshold).
   */
  async liftReportAutoBanIfApplicable(userId: string): Promise<{ lifted: boolean }> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { reportAutoBanActive: true, accountStatus: true }
    });
    if (!u?.reportAutoBanActive) {
      return { lifted: false };
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        accountStatus: "ACTIVE",
        bannedAt: null,
        banReason: null,
        reportAutoBanActive: false,
        reportBanNoLoginUntil: null
      }
    });
    return { lifted: true };
  }

  /**
   * Clear ban and restore active status (admin-initiated)
   */
  async unbanAccount(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        accountStatus: "ACTIVE",
        bannedAt: null,
        banReason: null,
        reportAutoBanActive: false,
        reportBanNoLoginUntil: null
      }
    });
  }

  /**
   * Dashboard "Account active" / restore login: reactivate DEACTIVATED, unsuspend SUSPENDED.
   * Does not unban — use unban for BANNED.
   */
  async adminRestoreLoginAccess(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { accountStatus: true }
    });
    if (!user) {
      throw new HttpException("User not found", HttpStatus.NOT_FOUND);
    }
    if (user.accountStatus === "BANNED") {
      throw new HttpException(
        "Account is restricted by an administrator. Use unban to restore access.",
        HttpStatus.BAD_REQUEST
      );
    }
    if (user.accountStatus === "ACTIVE") {
      return;
    }
    if (user.accountStatus === "DEACTIVATED") {
      await this.reactivateAccount(userId);
      return;
    }
    if (user.accountStatus === "SUSPENDED") {
      await this.unsuspendAccount(userId);
      return;
    }
    throw new HttpException("Account is not active.", HttpStatus.BAD_REQUEST);
  }

  /**
   * Permanently remove auth user row (dashboard hard delete). Sessions cleared via cascade.
   */
  async adminHardDeleteUser(userId: string): Promise<void> {
    const exists = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true }
    });
    if (!exists) {
      throw new HttpException("User not found", HttpStatus.NOT_FOUND);
    }
    await this.prisma.user.delete({ where: { id: userId } });
  }

  /**
   * List auth users for admin dashboards (pagination kept simple)
   */
  async listUsersForAdminDashboard() {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 1000,
      select: {
        id: true,
        email: true,
        phone: true,
        name: true,
        createdAt: true,
        updatedAt: true,
        accountStatus: true,
        bannedAt: true,
        banReason: true,
        reportAutoBanActive: true,
        reportBanNoLoginUntil: true,
        suspendedAt: true,
        suspensionReason: true,
        deactivatedAt: true,
        deletedAt: true
      }
    });
    return { ok: true, users };
  }

  /**
   * Single auth user row for admin dashboards (user-service merges with profile).
   */
  async getUserForAdminDashboard(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phone: true,
        name: true,
        createdAt: true,
        updatedAt: true,
        accountStatus: true,
        bannedAt: true,
        banReason: true,
        reportAutoBanActive: true,
        reportBanNoLoginUntil: true,
        suspendedAt: true,
        suspensionReason: true,
        deactivatedAt: true,
        deletedAt: true
      }
    });
    if (!user) {
      throw new HttpException("User not found", HttpStatus.NOT_FOUND);
    }
    return { ok: true, user };
  }

  /**
   * Delete user account (user-initiated, soft delete)
   * Sets deletedAt timestamp and deactivates account
   * Actual data deletion should be handled by a cleanup job
   */
  async deleteAccount(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        accountStatus: "DEACTIVATED",
        deletedAt: new Date(),
        deactivatedAt: new Date()
      }
    });

    // Delete all active sessions
    await this.prisma.session.deleteMany({
      where: { userId }
    });
  }

  /**
   * Check if account is active
   */
  async isAccountActive(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { accountStatus: true, deletedAt: true }
    });

    if (!user) return false;
    return user.accountStatus === "ACTIVE" && !user.deletedAt;
  }

  /**
   * Get account status
   */
  async getAccountStatus(userId: string): Promise<{
    status: string;
    deactivatedAt: Date | null;
    suspendedAt: Date | null;
    bannedAt: Date | null;
    deletedAt: Date | null;
    suspensionReason: string | null;
    banReason: string | null;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        accountStatus: true,
        deactivatedAt: true,
        suspendedAt: true,
        bannedAt: true,
        deletedAt: true,
        suspensionReason: true,
        banReason: true
      }
    });

    if (!user) {
      throw new HttpException("User not found", HttpStatus.NOT_FOUND);
    }

    return {
      status: user.accountStatus,
      deactivatedAt: user.deactivatedAt,
      suspendedAt: user.suspendedAt,
      bannedAt: user.bannedAt,
      deletedAt: user.deletedAt,
      suspensionReason: user.suspensionReason,
      banReason: user.banReason
    };
  }
}
