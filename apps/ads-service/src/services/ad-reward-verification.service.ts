import { BadRequestException, ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { AdRewardConfigService } from "../config/ad-reward.config.js";

export interface AdRewardVerificationInput {
  userId: string;
  adUnitId: string;
  adNetwork?: string;
  providerTransactionId?: string;
  rewardToken?: string;
  rewardSignature?: string;
  revenue?: number;
  eCPM?: number;
}

export interface VerifiedAdRewardProof {
  adNetwork: string;
  providerTransactionId: string;
  providerProofHash: string;
  revenue?: number;
  eCPM?: number;
}

@Injectable()
export class AdRewardVerificationService {
  private readonly logger = new Logger(AdRewardVerificationService.name);
  private warnedClientAttestation = false;

  constructor(private readonly configService: AdRewardConfigService) {}

  verifyCompletion(input: AdRewardVerificationInput): VerifiedAdRewardProof {
    const adNetwork = input.adNetwork?.trim() || "client";
    const providerTransactionId = (input.providerTransactionId || input.rewardToken)?.trim();

    if (!providerTransactionId) {
      throw new BadRequestException("providerTransactionId or rewardToken is required");
    }

    if (input.revenue !== undefined && input.revenue < 0) {
      throw new BadRequestException("revenue must be non-negative");
    }

    if (input.eCPM !== undefined && input.eCPM < 0) {
      throw new BadRequestException("eCPM must be non-negative");
    }

    const secret = this.configService.getRewardVerificationSecret();
    if (secret) {
      if (!input.rewardSignature) {
        throw new BadRequestException("rewardSignature is required");
      }

      const expectedSignature = this.signProof(
        secret,
        input.userId,
        input.adUnitId,
        adNetwork,
        providerTransactionId,
        input.rewardToken
      );

      if (!this.safeEqual(expectedSignature, input.rewardSignature)) {
        throw new ForbiddenException("Invalid ad reward proof");
      }
    } else if (!this.configService.allowsClientAttestation()) {
      throw new ForbiddenException("Server-side ad reward verification is not configured");
    } else if (!this.warnedClientAttestation) {
      this.logger.warn(
        "Ad reward verification is using client attestation. Configure AD_REWARD_VERIFICATION_SECRET before production."
      );
      this.warnedClientAttestation = true;
    }

    return {
      adNetwork,
      providerTransactionId,
      providerProofHash: this.hashProof(adNetwork, providerTransactionId, input.rewardToken, input.rewardSignature),
      revenue: input.revenue,
      eCPM: input.eCPM
    };
  }

  private signProof(
    secret: string,
    userId: string,
    adUnitId: string,
    adNetwork: string,
    providerTransactionId: string,
    rewardToken?: string
  ): string {
    return createHmac("sha256", secret)
      .update([userId, adUnitId, adNetwork, providerTransactionId, rewardToken || ""].join("."))
      .digest("hex");
  }

  private hashProof(
    adNetwork: string,
    providerTransactionId: string,
    rewardToken?: string,
    rewardSignature?: string
  ): string {
    return createHash("sha256")
      .update([adNetwork, providerTransactionId, rewardToken || "", rewardSignature || ""].join("."))
      .digest("hex");
  }

  private safeEqual(expected: string, actual: string): boolean {
    const expectedBuffer = Buffer.from(expected, "hex");
    const actualBuffer = Buffer.from(actual, "hex");
    if (expectedBuffer.length !== actualBuffer.length) {
      return false;
    }
    return timingSafeEqual(expectedBuffer, actualBuffer);
  }
}
