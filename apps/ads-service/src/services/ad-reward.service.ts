import { Injectable, Logger, BadRequestException, ForbiddenException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { WalletClientService } from "./wallet-client.service.js";
import { AdRewardConfigService } from "../config/ad-reward.config.js";

@Injectable()
export class AdRewardService {
  private readonly logger = new Logger(AdRewardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletClient: WalletClientService,
    private readonly configService: AdRewardConfigService
  ) {}

  /**
   * Verify ad completion and award coins to user
   */
  async verifyAndAwardReward(
    userId: string,
    adUnitId: string,
    adNetwork?: string
  ): Promise<{ success: boolean; coinsAwarded: number; newBalance: number; transactionId: string }> {
    // Check if ad rewards are enabled
    if (!this.configService.isAdRewardEnabled()) {
      throw new BadRequestException("Ad rewards are currently disabled");
    }

    // Get or create default config
    let config = await this.prisma.adRewardConfig.findUnique({
      where: { adType: "rewarded_video" }
    });

    if (!config) {
      // Create default config if it doesn't exist
      config = await this.prisma.adRewardConfig.create({
        data: {
          adType: "rewarded_video",
          coinsPerAd: this.configService.getCoinsPerAd(),
          isActive: true,
          minCooldown: this.configService.getCooldownSeconds(),
          maxAdsPerDay: this.configService.getMaxAdsPerDay()
        }
      });
    }

    if (!config.isActive) {
      throw new BadRequestException("Ad rewards are currently disabled");
    }

    // Check cooldown period
    const lastReward = await this.prisma.adReward.findFirst({
      where: {
        userId,
        status: "VERIFIED"
      },
      orderBy: { createdAt: "desc" }
    });

    if (lastReward) {
      const timeSinceLastReward = Date.now() - lastReward.createdAt.getTime();
      const cooldownMs = config.minCooldown * 1000;

      if (timeSinceLastReward < cooldownMs) {
        const remainingSeconds = Math.ceil((cooldownMs - timeSinceLastReward) / 1000);
        throw new ForbiddenException(
          `Please wait ${remainingSeconds} seconds before watching another ad. Cooldown period: ${config.minCooldown} seconds.`
        );
      }
    }

    // Check daily limit if configured
    if (config.maxAdsPerDay) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const todayRewards = await this.prisma.adReward.count({
        where: {
          userId,
          status: "VERIFIED",
          createdAt: {
            gte: today,
            lt: tomorrow
          }
        }
      });

      if (todayRewards >= config.maxAdsPerDay) {
        throw new ForbiddenException(
          `Daily limit reached. You can watch up to ${config.maxAdsPerDay} ads per day.`
        );
      }
    }

    // Create AdReward record with PENDING status
    const adReward = await this.prisma.adReward.create({
      data: {
        userId,
        adUnitId,
        adNetwork: adNetwork || null,
        coinsAwarded: config.coinsPerAd,
        status: "PENDING"
      }
    });

    try {
      // Credit coins to user wallet
      const walletResult = await this.walletClient.addCoins(
        userId,
        config.coinsPerAd,
        `Ad reward: Rewarded video ad (${adUnitId})`
      );

      // Update AdReward status to VERIFIED
      await this.prisma.adReward.update({
        where: { id: adReward.id },
        data: {
          status: "VERIFIED",
          verifiedAt: new Date()
        }
      });

      this.logger.log(
        `Ad reward verified and coins awarded: User ${userId}, ${config.coinsPerAd} coins, Transaction ${walletResult.transactionId}`
      );

      return {
        success: true,
        coinsAwarded: config.coinsPerAd,
        newBalance: walletResult.newBalance,
        transactionId: walletResult.transactionId
      };
    } catch (error: any) {
      // Mark reward as FAILED if wallet credit fails
      await this.prisma.adReward.update({
        where: { id: adReward.id },
        data: {
          status: "FAILED"
        }
      });

      this.logger.error(`Failed to award coins for ad reward ${adReward.id}: ${error.message}`);
      throw new BadRequestException(`Failed to award coins: ${error.message}`);
    }
  }

  /**
   * Get user's ad reward history
   */
  async getRewardHistory(
    userId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<Array<{
    id: string;
    adUnitId: string;
    adNetwork: string | null;
    coinsAwarded: number;
    status: string;
    createdAt: Date;
    verifiedAt: Date | null;
  }>> {
    const rewards = await this.prisma.adReward.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      select: {
        id: true,
        adUnitId: true,
        adNetwork: true,
        coinsAwarded: true,
        status: true,
        createdAt: true,
        verifiedAt: true
      }
    });

    return rewards;
  }

  /**
   * Get current reward configuration
   */
  async getRewardConfig(): Promise<{
    adType: string;
    coinsPerAd: number;
    isActive: boolean;
    minCooldown: number;
    maxAdsPerDay: number | null;
  }> {
    let config = await this.prisma.adRewardConfig.findUnique({
      where: { adType: "rewarded_video" }
    });

    if (!config) {
      // Return default config if not in database
      return {
        adType: "rewarded_video",
        coinsPerAd: this.configService.getCoinsPerAd(),
        isActive: this.configService.isAdRewardEnabled(),
        minCooldown: this.configService.getCooldownSeconds(),
        maxAdsPerDay: this.configService.getMaxAdsPerDay()
      };
    }

    return {
      adType: config.adType,
      coinsPerAd: config.coinsPerAd,
      isActive: config.isActive,
      minCooldown: config.minCooldown,
      maxAdsPerDay: config.maxAdsPerDay
    };
  }

  /**
   * Update reward configuration (Admin only - should be protected by auth middleware)
   */
  async updateRewardConfig(
    coinsPerAd?: number,
    isActive?: boolean,
    minCooldown?: number,
    maxAdsPerDay?: number | null
  ): Promise<{
    adType: string;
    coinsPerAd: number;
    isActive: boolean;
    minCooldown: number;
    maxAdsPerDay: number | null;
  }> {
    let config = await this.prisma.adRewardConfig.findUnique({
      where: { adType: "rewarded_video" }
    });

    if (!config) {
      config = await this.prisma.adRewardConfig.create({
        data: {
          adType: "rewarded_video",
          coinsPerAd: coinsPerAd ?? this.configService.getCoinsPerAd(),
          isActive: isActive ?? true,
          minCooldown: minCooldown ?? this.configService.getCooldownSeconds(),
          maxAdsPerDay: maxAdsPerDay ?? this.configService.getMaxAdsPerDay()
        }
      });
    } else {
      config = await this.prisma.adRewardConfig.update({
        where: { id: config.id },
        data: {
          ...(coinsPerAd !== undefined && { coinsPerAd }),
          ...(isActive !== undefined && { isActive }),
          ...(minCooldown !== undefined && { minCooldown }),
          ...(maxAdsPerDay !== undefined && { maxAdsPerDay })
        }
      });
    }

    this.logger.log(`Ad reward configuration updated: ${JSON.stringify(config)}`);

    return {
      adType: config.adType,
      coinsPerAd: config.coinsPerAd,
      isActive: config.isActive,
      minCooldown: config.minCooldown,
      maxAdsPerDay: config.maxAdsPerDay
    };
  }
}
