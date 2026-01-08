import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import fetch from "node-fetch";

@Injectable()
export class WalletClientService {
  private readonly logger = new Logger(WalletClientService.name);
  private readonly walletServiceUrl: string;

  constructor() {
    this.walletServiceUrl = process.env.WALLET_SERVICE_URL || "http://localhost:3006";
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
}
