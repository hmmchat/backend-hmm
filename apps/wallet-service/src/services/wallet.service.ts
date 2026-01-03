import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get wallet balance for a user
   * Creates wallet if it doesn't exist (lazy initialization)
   */
  async getBalance(userId: string): Promise<{ balance: number }> {
    let wallet = await this.prisma.wallet.findUnique({
      where: { id: userId }
    });

    // Lazy initialization: create wallet if it doesn't exist
    if (!wallet) {
      wallet = await this.prisma.wallet.create({
        data: {
          id: userId,
          balance: 0
        } as any // Type assertion for Prisma client type resolution
      });
    }

    return { balance: wallet.balance };
  }

  /**
   * Get wallet with transaction history
   */
  async getWallet(userId: string, includeTransactions = false) {
    if (includeTransactions) {
      let wallet = await this.prisma.wallet.findUnique({
        where: { id: userId },
        include: {
          transactions: {
            orderBy: { createdAt: "desc" },
            take: 50 // Last 50 transactions
          }
        }
      });

      if (!wallet) {
        await this.prisma.wallet.create({
          data: {
            id: userId,
            balance: 0
          } as any // Type assertion for Prisma client type resolution
        });
        // Fetch with transactions after creation
        wallet = await this.prisma.wallet.findUnique({
          where: { id: userId },
          include: {
            transactions: {
              orderBy: { createdAt: "desc" },
              take: 50
            }
          }
        }) as any;
      }
      return wallet;
    } else {
      let wallet = await this.prisma.wallet.findUnique({
        where: { id: userId }
      });

      if (!wallet) {
        wallet = await this.prisma.wallet.create({
          data: {
            id: userId,
            balance: 0
          } as any // Type assertion for Prisma client type resolution
        });
      }
      return wallet;
    }
  }

  /**
   * Deduct coins for gender filter purchase
   * @param userId User ID
   * @param amount Amount of coins to deduct
   * @param screens Number of screens this payment covers
   */
  async deductCoinsForGenderFilter(
    userId: string,
    amount: number,
    screens: number
  ): Promise<{ newBalance: number; transactionId: string }> {
    if (amount <= 0) {
      throw new Error("Amount must be positive");
    }

    // Get or create wallet
    let wallet = await this.prisma.wallet.findUnique({
      where: { id: userId }
    });

    if (!wallet) {
      wallet = await this.prisma.wallet.create({
        data: {
          id: userId,
          balance: 0
        } as any // Type assertion for Prisma client type resolution
      });
    }

    // Check balance
    if (wallet.balance < amount) {
      throw new Error(`Insufficient balance. Required: ${amount}, Available: ${wallet.balance}`);
    }

    // Deduct coins and create transaction
    const updatedWallet = await this.prisma.wallet.update({
      where: { id: userId },
      data: {
        balance: {
          decrement: amount
        }
      }
    });

    const transaction = await this.prisma.transaction.create({
      data: {
        walletId: wallet.id,
        amount: -amount, // Negative for debit
        type: "DEBIT",
        description: `Gender filter: ${screens} screens`
      }
    });

    return {
      newBalance: updatedWallet.balance,
      transactionId: transaction.id
    };
  }

  /**
   * Add coins to wallet (test method, bypasses auth)
   */
  async addCoinsForUser(
    userId: string,
    amount: number,
    description?: string
  ): Promise<{ newBalance: number; transactionId: string }> {
    if (amount <= 0) {
      throw new Error("Amount must be positive");
    }

    // Get or create wallet
    let wallet = await this.prisma.wallet.findUnique({
      where: { id: userId }
    });

    if (!wallet) {
      wallet = await this.prisma.wallet.create({
        data: {
          id: userId,
          balance: 0
        } as any // Type assertion for Prisma client type resolution
      });
    }

    // Add coins and create transaction
    const updatedWallet = await this.prisma.wallet.update({
      where: { id: userId },
      data: {
        balance: {
          increment: amount
        }
      }
    });

    const transaction = await this.prisma.transaction.create({
      data: {
        walletId: wallet.id,
        amount: amount, // Positive for credit
        type: "CREDIT",
        description: description || `Test credit: ${amount} coins`
      }
    });

    return {
      newBalance: updatedWallet.balance,
      transactionId: transaction.id
    };
  }
}

