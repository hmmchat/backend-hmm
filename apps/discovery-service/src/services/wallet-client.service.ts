import { Injectable, HttpException, HttpStatus } from "@nestjs/common";
import fetch from "node-fetch";

interface WalletBalanceResponse {
  balance: number;
}

interface DeductCoinsResponse {
  success: boolean;
  newBalance: number;
  transactionId: string;
}

@Injectable()
export class WalletClientService {
  private readonly walletServiceUrl: string;

  constructor() {
    this.walletServiceUrl = process.env.WALLET_SERVICE_URL || "http://localhost:3005";
  }

  /**
   * Get wallet balance for a user
   * @param token JWT access token
   */
  async getBalance(token: string): Promise<number> {
    try {
      const response = await fetch(`${this.walletServiceUrl}/me/balance`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Wallet service error: ${error}`);
      }

      const result = await response.json() as WalletBalanceResponse;
      return result.balance;
    } catch (error) {
      console.error("Failed to get balance from wallet-service:", error);
      throw new HttpException(
        "Unable to fetch wallet balance. Please try again later.",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  /**
   * Deduct coins for gender filter
   * @param token JWT access token
   * @param amount Amount of coins to deduct
   * @param screens Number of screens this payment covers
   */
  async deductCoinsForGenderFilter(
    token: string,
    amount: number,
    screens: number
  ): Promise<{ newBalance: number; transactionId: string }> {
    try {
      const response = await fetch(`${this.walletServiceUrl}/me/transactions/gender-filter`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          amount,
          screens
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 400) {
          throw new HttpException(errorText, HttpStatus.BAD_REQUEST);
        }
        throw new Error(`Wallet service error: ${errorText}`);
      }

      const result = await response.json() as DeductCoinsResponse;
      return {
        newBalance: result.newBalance,
        transactionId: result.transactionId
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      console.error("Failed to deduct coins from wallet-service:", error);
      throw new HttpException(
        "Unable to process payment. Please try again later.",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }
}

