import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import fetch from "node-fetch";
import { PrismaService } from "../prisma/prisma.service.js";

type KycDecision = "VERIFIED" | "REJECTED" | "REVIEW" | "REVOKED";
type KycStatus = "UNVERIFIED" | "VERIFIED" | "PENDING_REVIEW" | "REVOKED" | "EXPIRED";

interface UserKycSnapshot {
  userId: string;
  reportCount: number;
  kycStatus: KycStatus;
  kycRiskScore: number;
  kycExpiresAt: string | null;
  isModerator: boolean;
}

@Injectable()
export class KycService {
  private readonly userServiceUrl = process.env.USER_SERVICE_URL || "http://localhost:3002";
  private readonly walletServiceUrl = process.env.WALLET_SERVICE_URL || "http://localhost:3005";
  private readonly requestTimeoutMs = parseInt(process.env.KYC_SERVICE_TIMEOUT_MS || "5000", 10);

  constructor(private readonly prisma: PrismaService) {}

  private ensureKycEnabled() {
    if (process.env.KYC_ENABLED !== "true") {
      throw new HttpException("KYC feature is disabled", HttpStatus.FORBIDDEN);
    }
  }

  private async fetchWithTimeout(url: string, options: any) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      } as any);
      return response;
    } catch (error: any) {
      if (error?.name === "AbortError") {
        throw new HttpException(`Request timeout for ${url}`, HttpStatus.GATEWAY_TIMEOUT);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async getUserKycSnapshot(userId: string): Promise<UserKycSnapshot> {
    const response = await this.fetchWithTimeout(`${this.userServiceUrl}/users/internal/${userId}/kyc`, {
      method: "GET",
      headers: { "Content-Type": "application/json" }
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new HttpException(`Failed to load user KYC snapshot: ${errorText}`, HttpStatus.BAD_GATEWAY);
    }
    return response.json() as Promise<UserKycSnapshot>;
  }

  private async updateUserKyc(
    userId: string,
    payload: { kycStatus?: KycStatus; kycExpiresAt?: string | null; kycRiskScore?: number; isModerator?: boolean }
  ) {
    const response = await this.fetchWithTimeout(`${this.userServiceUrl}/users/internal/${userId}/kyc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new HttpException(`Failed to update user KYC state: ${errorText}`, HttpStatus.BAD_GATEWAY);
    }
    return response.json();
  }

  private getVerifiedExpiryDateIso(): string {
    const days = parseInt(process.env.KYC_EXPIRY_DAYS || "90", 10);
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + (Number.isNaN(days) || days <= 0 ? 90 : days));
    return expiry.toISOString();
  }

  async startSession(input: { userId: string; moderatorId: string }) {
    this.ensureKycEnabled();
    const snapshot = await this.getUserKycSnapshot(input.userId);
    const session = await (this.prisma as any).kycSession.create({
      data: {
        userId: input.userId,
        moderatorId: input.moderatorId,
        reportCount: snapshot.reportCount,
        kycRiskScore: snapshot.kycRiskScore
      }
    });

    return {
      sessionId: session.id,
      user: {
        userId: snapshot.userId,
        reportCount: snapshot.reportCount,
        kycStatus: snapshot.kycStatus,
        kycRiskScore: snapshot.kycRiskScore
      }
    };
  }

  async submitDecision(input: {
    sessionId: string;
    moderatorId: string;
    decision: KycDecision;
    reason?: string;
  }) {
    this.ensureKycEnabled();
    const session = await (this.prisma as any).kycSession.findUnique({
      where: { id: input.sessionId }
    });
    if (!session) {
      throw new HttpException("KYC session not found", HttpStatus.NOT_FOUND);
    }
    if (session.endedAt) {
      throw new HttpException("KYC session already closed", HttpStatus.CONFLICT);
    }
    if (session.moderatorId !== input.moderatorId) {
      throw new HttpException("Only the session moderator can submit decision", HttpStatus.FORBIDDEN);
    }

    let targetStatus: KycStatus = "PENDING_REVIEW";
    let expiresAt: string | null = null;
    if (input.decision === "VERIFIED") {
      targetStatus = "VERIFIED";
      expiresAt = this.getVerifiedExpiryDateIso();
    } else if (input.decision === "REVIEW") {
      targetStatus = "PENDING_REVIEW";
    } else if (input.decision === "REJECTED" || input.decision === "REVOKED") {
      targetStatus = "REVOKED";
    }

    await this.updateUserKyc(session.userId, {
      kycStatus: targetStatus,
      kycExpiresAt: expiresAt
    });
    const snapshot = await this.getUserKycSnapshot(session.userId);

    const updatedSession = await (this.prisma as any).kycSession.update({
      where: { id: input.sessionId },
      data: {
        decision: input.decision,
        decisionReason: input.reason || null,
        endedAt: new Date(),
        reportCount: snapshot.reportCount,
        kycRiskScore: snapshot.kycRiskScore
      }
    });

    return {
      sessionId: updatedSession.id,
      userId: updatedSession.userId,
      decision: updatedSession.decision,
      kycStatus: snapshot.kycStatus,
      kycRiskScore: snapshot.kycRiskScore,
      kycExpiresAt: snapshot.kycExpiresAt
    };
  }

  async revokeKyc(input: { userId: string; moderatorId?: string; reason?: string }) {
    this.ensureKycEnabled();
    const moderatorId = input.moderatorId || "admin_override";
    await this.updateUserKyc(input.userId, {
      kycStatus: "REVOKED",
      kycExpiresAt: null
    });
    const snapshot = await this.getUserKycSnapshot(input.userId);
    const session = await (this.prisma as any).kycSession.create({
      data: {
        userId: input.userId,
        moderatorId,
        reportCount: snapshot.reportCount,
        kycRiskScore: snapshot.kycRiskScore,
        decision: "REVOKED",
        decisionReason: input.reason || "Admin manual revoke",
        endedAt: new Date()
      }
    });

    return {
      sessionId: session.id,
      userId: input.userId,
      kycStatus: snapshot.kycStatus
    };
  }

  async submitFeedback(input: { userId: string; sessionId?: string; questionOne: string; questionTwo: string }) {
    this.ensureKycEnabled();
    const rewardEnabled = process.env.KYC_FEEDBACK_REWARD_ENABLED === "true";
    const rewardCoins = parseInt(process.env.KYC_FEEDBACK_REWARD_COINS || "25", 10);
    let rewardIssued = false;
    let rewardedCoins = 0;

    const feedbackData = {
      userId: input.userId,
      sessionId: input.sessionId || null,
      questionOne: input.questionOne,
      questionTwo: input.questionTwo
    };

    let feedbackRecord: any;
    if (input.sessionId) {
      feedbackRecord = await (this.prisma as any).kycFeedback.upsert({
        where: {
          userId_sessionId: {
            userId: input.userId,
            sessionId: input.sessionId
          }
        },
        update: {
          questionOne: input.questionOne,
          questionTwo: input.questionTwo
        },
        create: feedbackData
      });
    } else {
      feedbackRecord = await (this.prisma as any).kycFeedback.create({ data: feedbackData });
    }

    if (rewardEnabled && rewardCoins > 0 && !feedbackRecord.rewardIssued) {
      const walletResponse = await this.fetchWithTimeout(`${this.walletServiceUrl}/test/wallet/add-coins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: input.userId,
          amount: rewardCoins,
          description: "KYC feedback reward"
        })
      });
      if (walletResponse.ok) {
        rewardIssued = true;
        rewardedCoins = rewardCoins;
        await (this.prisma as any).kycFeedback.update({
          where: { id: feedbackRecord.id },
          data: {
            rewardIssued: true,
            rewardedCoins: rewardCoins
          }
        });
      }
    }

    return {
      ok: true,
      feedbackId: feedbackRecord.id,
      rewardIssued,
      rewardedCoins
    };
  }
}
