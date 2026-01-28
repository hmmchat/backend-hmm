import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import fetch from "node-fetch";

@Injectable()
export class WalletClientService {
  private readonly logger = new Logger(WalletClientService.name);
  private readonly walletServiceUrl: string;

  constructor() {
    this.walletServiceUrl = process.env.WALLET_SERVICE_URL || "http://localhost:3005";
  }

  /**
   * Get gift transactions for a user
   */
  async getGiftTransactions(userId: string): Promise<Array<{
    id: string;
    giftId: string | null;
    amount: number;
    description: string | null;
    createdAt: Date;
  }>> {
    try {
      const response = await fetch(`${this.walletServiceUrl}/test/wallet/gift-transactions?userId=${userId}`);
      if (!response.ok) {
        throw new Error(`Failed to get gift transactions for user ${userId}`);
      }
      const data = await response.json() as Array<{
        id: string;
        giftId: string | null;
        amount: number;
        description: string | null;
        createdAt: string;
      }>;
      
      // Convert date strings to Date objects
      return data.map(t => ({
        ...t,
        createdAt: new Date(t.createdAt)
      }));
    } catch (error: any) {
      this.logger.error(`Error getting gift transactions for ${userId}: ${error.message}`);
      throw new BadRequestException(`Failed to get gift transactions: ${error.message}`);
    }
  }

  /**
   * Award referral rewards to both referrer and referred user
   */
  async awardReferralRewards(
    referrerId: string,
    referredUserId: string,
    referrerReward: number,
    referredReward: number
  ): Promise<{
    referrerTransactionId: string;
    referredTransactionId: string;
    referrerNewBalance: number;
    referredNewBalance: number;
  }> {
    try {
      const response = await fetch(`${this.walletServiceUrl}/internal/referral-rewards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          referrerId,
          referredUserId,
          referrerReward,
          referredReward
        })
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        throw new Error(`Failed to award referral rewards: ${errorText}`);
      }

      return await response.json() as {
        referrerTransactionId: string;
        referredTransactionId: string;
        referrerNewBalance: number;
        referredNewBalance: number;
      };
    } catch (error: any) {
      this.logger.error(`Error awarding referral rewards: ${error.message}`);
      throw error; // Re-throw to let caller handle (don't block profile creation)
    }
  }
}
