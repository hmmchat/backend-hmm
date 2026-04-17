import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { TransactionKind, Prisma } from "../../node_modules/.prisma/client/index.js";

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  /** Coins per 1 diamond (e.g. 100 = 100 coins for 1 diamond). Aligns with payment service DIAMOND_TO_COIN_RATE. */
  private getCoinsPerDiamond(): number {
    return parseInt(process.env.DIAMOND_TO_COIN_RATE || "100", 10);
  }

  /**
   * Get wallet balance for a user (coins and diamonds)
   * Creates wallet if it doesn't exist (lazy initialization)
   */
  async getBalance(userId: string): Promise<{ balance: number; diamonds: number }> {
    let wallet = await this.prisma.wallet.findUnique({
      where: { id: userId }
    });

    // Lazy initialization: create wallet if it doesn't exist
    if (!wallet) {
      wallet = await this.prisma.wallet.create({
        data: {
          id: userId,
          balance: 0,
          diamonds: 0
        } as any // Type assertion for Prisma client type resolution
      });
    }

    return {
      balance: wallet.balance,
      diamonds: wallet.diamonds ?? 0
    };
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
            balance: 0,
            diamonds: 0
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
            balance: 0,
            diamonds: 0
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
          balance: 0,
          diamonds: 0
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
        description: `Gender filter: ${screens} screens`,
        transactionKind: TransactionKind.COINS
      }
    });

    return {
      newBalance: updatedWallet.balance,
      transactionId: transaction.id
    };
  }

  /**
   * Add coins to wallet (test method, bypasses auth)
   * @param giftId Optional gift sticker ID for gift transactions
   */
  async addCoinsForUser(
    userId: string,
    amount: number,
    description?: string,
    giftId?: string
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
          balance: 0,
          diamonds: 0
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

    // Use raw SQL if giftId is provided (due to Prisma client sync issues)
    // Otherwise use Prisma client for normal transactions
    let transactionId: string;

    if (giftId) {
      // First ensure giftId column exists (add if not present)
      try {
        await this.prisma.$executeRawUnsafe(
          `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS "giftId" TEXT;`
        );
      } catch (error: any) {
        // Column might already exist or other error - continue anyway
        // Ignore errors about column already existing
        if (!error.message?.includes("already exists") && !error.message?.includes("duplicate")) {
          console.warn("Warning: Could not ensure giftId column exists:", error.message);
        }
      }

      // Use raw SQL to insert transaction with giftId
      // Use Prisma from the local client
      const result = await this.prisma.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
        INSERT INTO transactions (
          id,
          "walletId",
          amount,
          type,
          description,
          "giftId",
          "createdAt"
        ) VALUES (
          gen_random_uuid()::text,
          ${wallet.id},
          ${amount},
          'CREDIT',
          ${description || `Test credit: ${amount} coins`},
          ${giftId},
          NOW()
        )
        RETURNING id
        `
      );
      transactionId = result[0].id;
    } else {
      // Use Prisma client for transactions without giftId
      const transaction = await this.prisma.transaction.create({
        data: {
          walletId: wallet.id,
          amount: amount, // Positive for credit
          type: "CREDIT",
          description: description || `Test credit: ${amount} coins`,
          transactionKind: TransactionKind.COINS
        }
      });
      transactionId = transaction.id;
    }

    return {
      newBalance: updatedWallet.balance,
      transactionId: transactionId
    };
  }

  /**
   * Deduct coins for dare payment (test method, bypasses auth)
   * @param userId User ID
   * @param amount Amount of coins to deduct
   * @param description Transaction description
   */
  async deductCoinsForDarePayment(
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
          balance: 0,
          diamonds: 0
        } as any
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
        description: description || `Dare payment: ${amount} coins`,
        transactionKind: TransactionKind.COINS
      }
    });

    return {
      newBalance: updatedWallet.balance,
      transactionId: transaction.id
    };
  }

  /**
   * Add diamonds to wallet (for conversion, gifts/dares received)
   */
  async addDiamondsForUser(
    userId: string,
    amount: number,
    description?: string,
    giftId?: string
  ): Promise<{ newDiamondBalance: number; transactionId: string }> {
    if (amount <= 0) {
      throw new Error("Amount must be positive");
    }

    let wallet = await this.prisma.wallet.findUnique({
      where: { id: userId }
    });

    if (!wallet) {
      wallet = await this.prisma.wallet.create({
        data: {
          id: userId,
          balance: 0,
          diamonds: 0
        } as any
      });
    }

    const updatedWallet = await this.prisma.wallet.update({
      where: { id: userId },
      data: {
        diamonds: {
          increment: amount
        }
      }
    });

    const transaction = await this.prisma.transaction.create({
      data: {
        walletId: wallet.id,
        amount: 0,
        type: "CREDIT",
        description: description || `Diamond credit: ${amount} diamonds`,
        giftId: giftId ?? undefined,
        diamondAmount: amount,
        transactionKind: TransactionKind.DIAMONDS
      }
    });

    return {
      newDiamondBalance: updatedWallet.diamonds,
      transactionId: transaction.id
    };
  }

  /**
   * Deduct diamonds from wallet (for gifts/dares sent, redemption)
   */
  async deductDiamondsForUser(
    userId: string,
    amount: number,
    description?: string
  ): Promise<{ newDiamondBalance: number; transactionId: string }> {
    if (amount <= 0) {
      throw new Error("Amount must be positive");
    }

    let wallet = await this.prisma.wallet.findUnique({
      where: { id: userId }
    });

    if (!wallet) {
      wallet = await this.prisma.wallet.create({
        data: {
          id: userId,
          balance: 0,
          diamonds: 0
        } as any
      });
    }

    const currentDiamonds = wallet.diamonds ?? 0;
    if (currentDiamonds < amount) {
      throw new Error(
        `Insufficient diamonds. Required: ${amount}, Available: ${currentDiamonds}`
      );
    }

    const updatedWallet = await this.prisma.wallet.update({
      where: { id: userId },
      data: {
        diamonds: {
          decrement: amount
        }
      }
    });

    const transaction = await this.prisma.transaction.create({
      data: {
        walletId: wallet.id,
        amount: 0,
        type: "DEBIT",
        description: description || `Diamond debit: ${amount} diamonds`,
        diamondAmount: -amount,
        transactionKind: TransactionKind.DIAMONDS
      }
    });

    return {
      newDiamondBalance: updatedWallet.diamonds,
      transactionId: transaction.id
    };
  }

  /**
   * Transfer diamonds from one user to another (gifts/dares)
   */
  async transferDiamonds(
    fromUserId: string,
    toUserId: string,
    amount: number,
    description?: string,
    giftId?: string
  ): Promise<{ transactionId: string; newDiamondBalance: number }> {
    if (amount <= 0) {
      throw new Error("Amount must be positive");
    }

    const deductResult = await this.deductDiamondsForUser(
      fromUserId,
      amount,
      description || `Diamond transfer to user ${toUserId}`
    );

    try {
      await this.addDiamondsForUser(
        toUserId,
        amount,
        `Diamond transfer from user ${fromUserId}` + (description ? `: ${description}` : ""),
        giftId
      );
    } catch (error) {
      await this.addDiamondsForUser(
        fromUserId,
        amount,
        `Refund: failed diamond transfer to user ${toUserId}`
      );
      throw error;
    }

    return {
      transactionId: deductResult.transactionId,
      newDiamondBalance: deductResult.newDiamondBalance
    };
  }

  /**
   * Purchase diamonds with coins (explicit conversion)
   */
  async purchaseDiamondsFromCoins(
    userId: string,
    diamondAmount: number,
    rate?: number
  ): Promise<{
    newBalance: number;
    newDiamondBalance: number;
    coinsSpent: number;
    transactionId: string;
  }> {
    if (diamondAmount <= 0) {
      throw new Error("Diamond amount must be positive");
    }

    const coinsPerDiamond = rate ?? this.getCoinsPerDiamond();
    const coinsNeeded = diamondAmount * coinsPerDiamond;

    let wallet = await this.prisma.wallet.findUnique({
      where: { id: userId }
    });

    if (!wallet) {
      wallet = await this.prisma.wallet.create({
        data: {
          id: userId,
          balance: 0,
          diamonds: 0
        } as any
      });
    }

    if (wallet.balance < coinsNeeded) {
      throw new Error(
        `Insufficient coins. Need ${coinsNeeded} coins for ${diamondAmount} diamonds (${coinsPerDiamond} coins per diamond), available: ${wallet.balance}`
      );
    }

    const updatedWallet = await this.prisma.wallet.update({
      where: { id: userId },
      data: {
        balance: { decrement: coinsNeeded },
        diamonds: { increment: diamondAmount }
      }
    });

    const transaction = await this.prisma.transaction.create({
      data: {
        walletId: wallet.id,
        amount: -coinsNeeded,
        type: "DEBIT",
        description: `Converted ${coinsNeeded} coins to ${diamondAmount} diamonds`,
        diamondAmount,
        transactionKind: TransactionKind.CONVERSION
      }
    });

    return {
      newBalance: updatedWallet.balance,
      newDiamondBalance: updatedWallet.diamonds,
      coinsSpent: coinsNeeded,
      transactionId: transaction.id
    };
  }

  /**
   * Get transactions with gift information for a user
   * All gifts are sent with giftId, so we only return transactions with giftId
   */
  async getGiftTransactions(userId: string): Promise<Array<{
    id: string;
    giftId: string;
    amount: number;
    description: string | null;
    createdAt: Date;
  }>> {
    // Check if wallet exists
    const wallet = await this.prisma.wallet.findUnique({
      where: { id: userId }
    });

    if (!wallet) {
      return [];
    }

    // Ensure giftId column exists
    try {
      await this.prisma.$executeRawUnsafe(
        `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS "giftId" TEXT;`
      );
    } catch (error: any) {
      // Column might already exist - ignore
    }

    // Use Prisma from the local client
    const transactions = await this.prisma.$queryRaw<Array<{
      id: string;
      giftId: string;
      amount: number;
      description: string | null;
      createdAt: Date;
    }>>(
      Prisma.sql`
        SELECT
          t.id,
          t."giftId",
          t.amount,
          t.description,
          t."createdAt"
        FROM transactions t
        WHERE t."walletId" = ${userId}
          AND t.type = 'CREDIT'
          AND t."giftId" IS NOT NULL
          AND t."giftId" != ''
        ORDER BY t."createdAt" DESC
      `
    );

    return transactions.map(t => ({
      id: t.id,
      giftId: t.giftId,
      amount: t.amount,
      description: t.description,
      createdAt: t.createdAt
    }));
  }

  private async ensureReferralPayoutTable(): Promise<void> {
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS referral_reward_payouts (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "referredUserId" TEXT NOT NULL UNIQUE,
        "referrerId" TEXT NOT NULL,
        "referrerReward" INTEGER NOT NULL,
        "referredReward" INTEGER NOT NULL,
        "referrerTransactionId" TEXT,
        "referredTransactionId" TEXT,
        "awardedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "referral_reward_payouts_referrerId_idx"
      ON referral_reward_payouts("referrerId");
    `);
  }

  /**
   * Award referral rewards to both referrer and referred user
   * @param referrerId User who made the referral
   * @param referredUserId User who was referred
   * @param referrerReward Amount of coins for referrer
   * @param referredReward Amount of coins for referred user
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
    alreadyAwarded: boolean;
  }> {
    if (referrerReward <= 0 || referredReward <= 0) {
      throw new Error("Reward amounts must be positive");
    }
    if (referrerId === referredUserId) {
      throw new Error("Self referral rewards are not allowed");
    }

    await this.ensureReferralPayoutTable();

    return this.prisma.$transaction(async (tx) => {
      const existingPayout = await tx.$queryRaw<Array<{
        referrerTransactionId: string | null;
        referredTransactionId: string | null;
      }>>(
        Prisma.sql`
          SELECT "referrerTransactionId", "referredTransactionId"
          FROM referral_reward_payouts
          WHERE "referredUserId" = ${referredUserId}
          LIMIT 1
        `
      );

      if (existingPayout.length > 0 && existingPayout[0].referrerTransactionId && existingPayout[0].referredTransactionId) {
        const [referrerWallet, referredWallet] = await Promise.all([
          tx.wallet.findUnique({ where: { id: referrerId }, select: { balance: true } }),
          tx.wallet.findUnique({ where: { id: referredUserId }, select: { balance: true } })
        ]);

        return {
          referrerTransactionId: existingPayout[0].referrerTransactionId,
          referredTransactionId: existingPayout[0].referredTransactionId,
          referrerNewBalance: referrerWallet?.balance ?? 0,
          referredNewBalance: referredWallet?.balance ?? 0,
          alreadyAwarded: true
        };
      }

      const inserted = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          INSERT INTO referral_reward_payouts (
            id,
            "referredUserId",
            "referrerId",
            "referrerReward",
            "referredReward",
            "createdAt"
          ) VALUES (
            gen_random_uuid()::text,
            ${referredUserId},
            ${referrerId},
            ${referrerReward},
            ${referredReward},
            NOW()
          )
          ON CONFLICT ("referredUserId") DO NOTHING
          RETURNING id
        `
      );

      if (inserted.length === 0) {
        const payout = await tx.$queryRaw<Array<{
          referrerTransactionId: string | null;
          referredTransactionId: string | null;
        }>>(
          Prisma.sql`
            SELECT "referrerTransactionId", "referredTransactionId"
            FROM referral_reward_payouts
            WHERE "referredUserId" = ${referredUserId}
            LIMIT 1
          `
        );
        const [referrerWallet, referredWallet] = await Promise.all([
          tx.wallet.findUnique({ where: { id: referrerId }, select: { balance: true } }),
          tx.wallet.findUnique({ where: { id: referredUserId }, select: { balance: true } })
        ]);

        return {
          referrerTransactionId: payout[0]?.referrerTransactionId || "",
          referredTransactionId: payout[0]?.referredTransactionId || "",
          referrerNewBalance: referrerWallet?.balance ?? 0,
          referredNewBalance: referredWallet?.balance ?? 0,
          alreadyAwarded: true
        };
      }

      await tx.wallet.upsert({
        where: { id: referrerId },
        update: {},
        create: {
          id: referrerId,
          balance: 0,
          diamonds: 0
        } as any
      });
      await tx.wallet.upsert({
        where: { id: referredUserId },
        update: {},
        create: {
          id: referredUserId,
          balance: 0,
          diamonds: 0
        } as any
      });

      const [updatedReferrerWallet, updatedReferredWallet] = await Promise.all([
        tx.wallet.update({
          where: { id: referrerId },
          data: { balance: { increment: referrerReward } },
          select: { id: true, balance: true }
        }),
        tx.wallet.update({
          where: { id: referredUserId },
          data: { balance: { increment: referredReward } },
          select: { id: true, balance: true }
        })
      ]);

      const [referrerTransaction, referredTransaction] = await Promise.all([
        tx.transaction.create({
          data: {
            walletId: updatedReferrerWallet.id,
            amount: referrerReward,
            type: "CREDIT",
            description: `Referral reward: referred user ${referredUserId} [referral:${referredUserId}]`,
            transactionKind: TransactionKind.COINS
          }
        }),
        tx.transaction.create({
          data: {
            walletId: updatedReferredWallet.id,
            amount: referredReward,
            type: "CREDIT",
            description: `Referral reward: referred by user ${referrerId} [referral:${referredUserId}]`,
            transactionKind: TransactionKind.COINS
          }
        })
      ]);

      await tx.$executeRaw(
        Prisma.sql`
          UPDATE referral_reward_payouts
          SET
            "referrerTransactionId" = ${referrerTransaction.id},
            "referredTransactionId" = ${referredTransaction.id},
            "awardedAt" = NOW()
          WHERE "referredUserId" = ${referredUserId}
        `
      );

      return {
        referrerTransactionId: referrerTransaction.id,
        referredTransactionId: referredTransaction.id,
        referrerNewBalance: updatedReferrerWallet.balance,
        referredNewBalance: updatedReferredWallet.balance,
        alreadyAwarded: false
      };
    });
  }
}

