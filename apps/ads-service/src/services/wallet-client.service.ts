import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import fetch from "node-fetch";
import { AdRewardConfigService } from "../config/ad-reward.config.js";

@Injectable()
export class WalletClientService {
  private readonly logger = new Logger(WalletClientService.name);
  private readonly walletServiceUrl: string;
  private readonly internalServiceToken: string | null;

  constructor(configService: AdRewardConfigService) {
    this.walletServiceUrl = configService.getWalletServiceUrl();
    this.internalServiceToken = configService.getInternalServiceToken();
  }

  /**
   * Add coins to user wallet (after ad completion) with retry logic
   */
  async addCoins(
    userId: string,
    amount: number,
    description?: string,
    retries: number = 3
  ): Promise<{ newBalance: number; transactionId: string }> {
    let lastError: any;

    if (!this.internalServiceToken) {
      throw new BadRequestException("INTERNAL_SERVICE_TOKEN is not configured");
    }
    
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await fetch(`${this.walletServiceUrl}/internal/wallet/add-coins`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-token": this.internalServiceToken
          },
          body: JSON.stringify({
            userId,
            amount,
            description: description || `Ad reward: ${amount} coins`
          }),
          signal: AbortSignal.timeout(10000) // 10 second timeout
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ message: "Unknown error" })) as { message?: string };
          lastError = new BadRequestException(
            `Failed to add coins to user ${userId}: ${errorData.message || "Unknown error"}`
          );
          
          // Don't retry on 4xx errors (client errors)
          if (response.status >= 400 && response.status < 500) {
            throw lastError;
          }
          
          // Retry on 5xx errors
          if (attempt < retries) {
            await this.delay(1000 * attempt); // Exponential backoff
            continue;
          }
          
          throw lastError;
        }

        const result = await response.json() as { newBalance: number; transactionId: string };
        this.logger.log(`Added ${amount} coins to user ${userId}. New balance: ${result.newBalance}`);
        return result;
      } catch (error: any) {
        lastError = error;
        
        if (error instanceof BadRequestException && error.message.includes("Failed to add coins")) {
          throw error; // Don't retry client errors
        }
        
        // Retry on network errors or server errors
        if (attempt < retries && (error.name === "AbortError" || error.code === "ECONNREFUSED" || error.code === "ETIMEDOUT")) {
          this.logger.warn(`Attempt ${attempt} failed to add coins to ${userId}, retrying...`);
          await this.delay(1000 * attempt); // Exponential backoff
          continue;
        }
        
        if (attempt === retries) {
          this.logger.error(`Error adding coins to ${userId} after ${retries} attempts: ${error.message}`);
          throw new BadRequestException(`Failed to add coins after ${retries} attempts: ${error.message}`);
        }
      }
    }
    
    throw lastError || new BadRequestException("Failed to add coins: Unknown error");
  }

  /**
   * Delay helper for retry logic
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
