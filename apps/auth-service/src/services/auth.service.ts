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

  async loginWithGoogle(idToken: string, termsVer: string) {
    const g = await this.google.verify(idToken);
    return this.signInOrUp(
      {
        email: g.email,
        googleSub: g.sub
      },
      termsVer
    );
  }

  async loginWithApple(identityToken: string, termsVer: string) {
    const a = await this.apple.verify(identityToken);
    return this.signInOrUp(
      {
        email: a.email,
        appleSub: a.sub
      },
      termsVer
    );
  }

  async loginWithFacebook(accessToken: string, termsVer: string) {
    const f = await this.facebook.verify(accessToken);
    return this.signInOrUp(
      {
        email: f.email,
        facebookId: f.id
      },
      termsVer
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

  async verifyPhoneOtp(phone: string, code: string, termsVer: string) {
    await this.phone.verify(phone, code);
    return this.signInOrUp({ phone }, termsVer);
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

  private async signInOrUp(
    data: Partial<{
      email: string | null;
      phone: string | null;
      googleSub: string | null;
      appleSub: string | null;
      facebookId: string | null;
    }>,
    termsVer: string
  ) {
    const user =
      (await this.prisma.user.findFirst({
        where: {
          OR: [
            data.googleSub && { googleSub: data.googleSub },
            data.appleSub && { appleSub: data.appleSub },
            data.facebookId && { facebookId: data.facebookId },
            data.email && { email: data.email },
            data.phone && { phone: data.phone }
          ].filter(Boolean) as any
        }
      })) ??
      (await this.prisma.user.create({
        data: {
          email: data.email ?? undefined,
          phone: data.phone ?? undefined,
          googleSub: data.googleSub ?? undefined,
          appleSub: data.appleSub ?? undefined,
          facebookId: data.facebookId ?? undefined,
          acceptedTerms: true,
          acceptedTermsAt: new Date(),
          acceptedTermsVer: termsVer
        }
      }));

    // Check account status - prevent login for deactivated, suspended, banned, or deleted accounts
    if (user.accountStatus !== "ACTIVE" || user.deletedAt) {
      const statusMessages: Record<string, string> = {
        DEACTIVATED: "Account has been deactivated. Please contact support to reactivate.",
        SUSPENDED: user.suspensionReason 
          ? `Account has been suspended: ${user.suspensionReason}` 
          : "Account has been suspended. Please contact support.",
        BANNED: user.banReason 
          ? `Account has been banned: ${user.banReason}` 
          : "Account has been banned. This action cannot be reversed."
      };
      
      throw new HttpException(
        statusMessages[user.accountStatus] || "Account is not active",
        HttpStatus.FORBIDDEN
      );
    }

    const accessToken = await signAccessToken(this.privateKey, {
      sub: user.id,
      uid: user.id
    });

    const refreshToken = await signRefreshToken(this.privateKey, {
      sub: user.id,
      uid: user.id
    });

    await this.prisma.session.create({
      data: {
        userId: user.id,
        refreshHash: await argon2.hash(refreshToken),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      }
    });

    return { accessToken, refreshToken };
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
   * Reactivate user account
   * Sets accountStatus back to ACTIVE and clears deactivatedAt
   */
  async reactivateAccount(userId: string): Promise<void> {
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
   * Ban user account (admin-initiated, permanent)
   * Sets accountStatus to BANNED with reason
   */
  async banAccount(userId: string, reason: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        accountStatus: "BANNED",
        bannedAt: new Date(),
        banReason: reason
      }
    });

    // Delete all active sessions
    await this.prisma.session.deleteMany({
      where: { userId }
    });
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
