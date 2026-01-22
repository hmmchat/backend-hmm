import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import fetch from "node-fetch";

@Injectable()
export class WalletClientService {
  private readonly logger = new Logger(WalletClientService.name);
  private readonly walletServiceUrl: string;

  constructor() {
    this.walletServiceUrl = process.env.WALLET_SERVICE_URL || "http://localhost:3005";
  }

  async deductCoins(
    userId: string,
    amount: number,
    description: string
  ): Promise<{ transactionId: string; newBalance: number }> {
    try {
      const response = await fetch(`${this.walletServiceUrl}/test/transactions/dare-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          amount,
          description
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: "Unknown error" })) as { message?: string };
        throw new BadRequestException(
          `Failed to deduct coins: ${errorData.message || "Insufficient balance"}`
        );
      }

      return await response.json() as { transactionId: string; newBalance: number };
    } catch (error: any) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Error deducting coins: ${error.message}`);
      throw new BadRequestException(`Failed to deduct coins: ${error.message}`);
    }
  }

  /**
   * Transfer coins between users (for gifts)
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
            description: `Gift payment rollback: ${description}`
          })
        }).catch(() => {
          this.logger.error(`Failed to rollback payment from ${fromUserId} to ${toUserId}`);
        });

        throw new BadRequestException(`Failed to credit coins to ${toUserId}`);
      }

      this.logger.log(`Transferred ${coins} coins from ${fromUserId} to ${toUserId} for gift payment`);

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
}
