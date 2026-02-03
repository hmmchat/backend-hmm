import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import fetch from "node-fetch";

// Configurable conversion rates (can be set via environment variables)
const DIAMOND_TO_COIN_RATE = parseInt(process.env.DIAMOND_TO_COIN_RATE || "50", 10); // 1 diamond = 50 coins (default)
// const INR_TO_DIAMOND_RATE = parseFloat(process.env.INR_TO_DIAMOND_RATE || "2"); // 1 INR = 2 diamonds (for future cashout feature)

@Injectable()
export class WalletClientService {
  private readonly logger = new Logger(WalletClientService.name);
  private readonly walletServiceUrl: string;

  constructor() {
    this.walletServiceUrl = process.env.WALLET_SERVICE_URL || "http://localhost:3005";
  }

  /**
   * Get diamond to coin conversion rate
   */
  getDiamondToCoinRate(): number {
    return DIAMOND_TO_COIN_RATE;
  }

  /**
   * Convert diamonds to coins
   */
  diamondsToCoins(diamonds: number): number {
    return diamonds * DIAMOND_TO_COIN_RATE;
  }

  /**
   * Convert coins to diamonds
   */
  coinsToDiamonds(coins: number): number {
    return Math.floor(coins / DIAMOND_TO_COIN_RATE);
  }

  /**
   * Transfer coins between users (for dare payments and gifts)
   * @param fromUserId User paying
   * @param toUserId User receiving
   * @param coins Amount in coins
   * @param description Transaction description
   * @param giftId Gift sticker ID (required for gift transactions)
   */
  async transferCoins(
    fromUserId: string,
    toUserId: string,
    coins: number,
    description: string,
    giftId: string
  ): Promise<{ transactionId: string; newBalance: number }> {
    try {
      // First deduct from sender
      const deductResponse = await fetch(`${this.walletServiceUrl}/test/transactions/dare-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: fromUserId,
          amount: coins,
          description: description
        })
      });

      if (!deductResponse.ok) {
        const errorData = await deductResponse.json().catch(() => ({ message: "Unknown error" })) as { message?: string };
        throw new BadRequestException(
          `Failed to deduct coins from ${fromUserId}: ${errorData.message || "Insufficient balance"}`
        );
      }

      const deductResult = await deductResponse.json() as { transactionId: string; newBalance: number };

      // Then credit to receiver with gift information
      const creditResponse = await fetch(`${this.walletServiceUrl}/test/wallet/add-coins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: toUserId,
          amount: coins,
          description: `Gift payment (credit): ${description}`,
          giftId: giftId // Pass giftId to wallet service
        })
      });

      if (!creditResponse.ok) {
        // Rollback: try to refund the deducted amount
        await fetch(`${this.walletServiceUrl}/test/wallet/add-coins`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: fromUserId,
            amount: coins,
            description: `Dare payment rollback: ${description}`
          })
        }).catch(() => {
          this.logger.error(`Failed to rollback payment from ${fromUserId} to ${toUserId}`);
        });

        throw new BadRequestException(`Failed to credit coins to ${toUserId}`);
      }

      this.logger.log(`Transferred ${coins} coins from ${fromUserId} to ${toUserId} for dare payment`);

      return {
        transactionId: deductResult.transactionId,
        newBalance: deductResult.newBalance
      };
    } catch (error: any) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Error transferring coins: ${error.message}`);
      throw new BadRequestException(`Failed to transfer coins: ${error.message}`);
    }
  }

  /**
   * Check user balance in coins
   */
  async getBalance(userId: string): Promise<number> {
    try {
      const response = await fetch(`${this.walletServiceUrl}/test/balance?userId=${userId}`);
      if (!response.ok) {
        throw new Error(`Failed to get balance for user ${userId}`);
      }
      const data = await response.json() as { balance: number; diamonds?: number };
      return data.balance || 0;
    } catch (error: any) {
      this.logger.error(`Error getting balance for ${userId}: ${error.message}`);
      throw new BadRequestException(`Failed to get balance: ${error.message}`);
    }
  }

  /**
   * Get user diamond balance (separate from coins)
   */
  async getDiamondBalance(userId: string): Promise<number> {
    try {
      const response = await fetch(`${this.walletServiceUrl}/test/balance?userId=${userId}`);
      if (!response.ok) {
        throw new Error(`Failed to get balance for user ${userId}`);
      }
      const data = await response.json() as { balance: number; diamonds?: number };
      return data.diamonds ?? 0;
    } catch (error: any) {
      this.logger.error(`Error getting diamond balance for ${userId}: ${error.message}`);
      throw new BadRequestException(`Failed to get diamond balance: ${error.message}`);
    }
  }

  /**
   * Transfer diamonds between users (for dare payments and gifts)
   * Sender pays diamonds; receiver gets diamonds.
   */
  async transferDiamonds(
    fromUserId: string,
    toUserId: string,
    diamonds: number,
    description: string,
    giftId: string
  ): Promise<{ transactionId: string; newDiamondBalance: number }> {
    try {
      const response = await fetch(`${this.walletServiceUrl}/test/wallet/transfer-diamonds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromUserId,
          toUserId,
          amount: diamonds,
          description,
          giftId
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: "Unknown error" })) as { message?: string };
        throw new BadRequestException(
          `Failed to transfer diamonds from ${fromUserId} to ${toUserId}: ${errorData.message || "Insufficient diamonds"}`
        );
      }

      const result = await response.json() as { transactionId: string; newDiamondBalance: number };
      this.logger.log(`Transferred ${diamonds} diamonds from ${fromUserId} to ${toUserId} for gift/dare`);

      return result;
    } catch (error: any) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Error transferring diamonds: ${error.message}`);
      throw new BadRequestException(`Failed to transfer diamonds: ${error.message}`);
    }
  }
}
