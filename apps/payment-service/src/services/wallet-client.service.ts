import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import fetch from "node-fetch";
import { PaymentConfigService } from "../config/payment.config.js";

@Injectable()
export class WalletClientService {
  private readonly logger = new Logger(WalletClientService.name);
  private readonly walletServiceUrl: string;

  constructor(private readonly configService: PaymentConfigService) {
    this.walletServiceUrl = configService.getWalletServiceUrl();
  }

  /**
   * Get coin balance for a user with retry logic
   */
  async getBalance(userId: string, retries: number = 3): Promise<number> {
    let lastError: any;
    
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await fetch(`${this.walletServiceUrl}/test/balance?userId=${userId}`, {
          signal: AbortSignal.timeout(5000) // 5 second timeout
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ message: "Unknown error" })) as { message?: string };
          lastError = new BadRequestException(
            `Failed to get balance for user ${userId}: ${errorData.message || "Unknown error"}`
          );
          
          if (response.status >= 400 && response.status < 500) {
            throw lastError; // Don't retry client errors
          }
          
          if (attempt < retries) {
            await this.delay(1000 * attempt);
            continue;
          }
          
          throw lastError;
        }

        const data = await response.json() as { balance: number };
        return data.balance || 0;
      } catch (error: any) {
        lastError = error;
        
        if (error instanceof BadRequestException && error.message.includes("Failed to get balance")) {
          throw error;
        }
        
        if (attempt < retries && (error.name === "AbortError" || error.code === "ECONNREFUSED" || error.code === "ETIMEDOUT")) {
          this.logger.warn(`Attempt ${attempt} failed to get balance for ${userId}, retrying...`);
          await this.delay(1000 * attempt);
          continue;
        }
        
        if (attempt === retries) {
          this.logger.error(`Error getting balance for ${userId} after ${retries} attempts: ${error.message}`);
          throw new BadRequestException(`Failed to get balance after ${retries} attempts: ${error.message}`);
        }
      }
    }
    
    throw lastError || new BadRequestException("Failed to get balance: Unknown error");
  }

  /**
   * Add coins to user wallet (after purchase) with retry logic
   */
  async addCoins(
    userId: string,
    amount: number,
    description?: string,
    retries: number = 3
  ): Promise<{ newBalance: number; transactionId: string }> {
    let lastError: any;
    
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await fetch(`${this.walletServiceUrl}/test/wallet/add-coins`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
            amount,
            description: description || `Coin purchase: ${amount} coins`
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

  /**
   * Deduct coins from user wallet (for redemption) with retry logic
   */
  async deductCoins(
    userId: string,
    amount: number,
    description?: string,
    retries: number = 3
  ): Promise<{ newBalance: number; transactionId: string }> {
    let lastError: any;
    
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        // We'll need to create a proper endpoint in wallet-service for this
        // For now, using the dare-payment endpoint as a workaround
        const response = await fetch(`${this.walletServiceUrl}/test/transactions/dare-payment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
            amount,
            description: description || `Coin redemption: ${amount} coins`
          }),
          signal: AbortSignal.timeout(10000) // 10 second timeout
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ message: "Unknown error" })) as { message?: string };
          
          if (errorData.message?.includes("Insufficient balance")) {
            throw new BadRequestException(`Insufficient balance: ${errorData.message}`);
          }
          
          lastError = new BadRequestException(
            `Failed to deduct coins from user ${userId}: ${errorData.message || "Unknown error"}`
          );
          
          // Don't retry on 4xx errors (client errors like insufficient balance)
          if (response.status >= 400 && response.status < 500) {
            throw lastError;
          }
          
          // Retry on 5xx errors
          if (attempt < retries) {
            await this.delay(1000 * attempt);
            continue;
          }
          
          throw lastError;
        }

        const result = await response.json() as { newBalance: number; transactionId: string };
        this.logger.log(`Deducted ${amount} coins from user ${userId}. New balance: ${result.newBalance}`);
        return result;
      } catch (error: any) {
        lastError = error;
        
        // Don't retry on insufficient balance or other client errors
        if (error instanceof BadRequestException && 
            (error.message.includes("Insufficient balance") || error.message.includes("Failed to deduct coins"))) {
          throw error;
        }
        
        // Retry on network errors or server errors
        if (attempt < retries && (error.name === "AbortError" || error.code === "ECONNREFUSED" || error.code === "ETIMEDOUT")) {
          this.logger.warn(`Attempt ${attempt} failed to deduct coins from ${userId}, retrying...`);
          await this.delay(1000 * attempt);
          continue;
        }
        
        if (attempt === retries) {
          this.logger.error(`Error deducting coins from ${userId} after ${retries} attempts: ${error.message}`);
          throw new BadRequestException(`Failed to deduct coins after ${retries} attempts: ${error.message}`);
        }
      }
    }
    
    throw lastError || new BadRequestException("Failed to deduct coins: Unknown error");
  }

  /**
   * Convert coins to diamonds using configured rate
   */
  convertCoinsToDiamonds(coins: number): number {
    return this.configService.coinsToDiamonds(coins);
  }

  /**
   * Convert diamonds to coins using configured rate
   */
  convertDiamondsToCoins(diamonds: number): number {
    return this.configService.diamondsToCoins(diamonds);
  }

  /**
   * Get diamond balance (calculated from coins)
   */
  async getDiamondBalance(userId: string): Promise<number> {
    const coins = await this.getBalance(userId);
    return this.convertCoinsToDiamonds(coins);
  }
}
