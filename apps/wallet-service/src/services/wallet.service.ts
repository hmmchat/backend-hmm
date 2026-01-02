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
      where: { userId }
    });

    // Lazy initialization: create wallet if it doesn't exist
    if (!wallet) {
      wallet = await this.prisma.wallet.create({
        data: {
          id: userId,
          userId,
          balance: 0
        }
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
        where: { userId },
        include: {
          transactions: {
            orderBy: { createdAt: "desc" },
            take: 50 // Last 50 transactions
          }
        }
      });

      if (!wallet) {
        wallet = await this.prisma.wallet.create({
          data: {
            id: userId,
            userId,
            balance: 0
          },
          include: {
            transactions: true
          }
        });
      }
      return wallet;
    } else {
      let wallet = await this.prisma.wallet.findUnique({
        where: { userId }
      });

      if (!wallet) {
        wallet = await this.prisma.wallet.create({
          data: {
            id: userId,
            userId,
            balance: 0
          }
        });
      }
      return wallet;
    }
  }
}

