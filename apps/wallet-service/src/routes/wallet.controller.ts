import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
  HttpException,
  HttpStatus,
  Query
} from "@nestjs/common";
import { WalletService } from "../services/wallet.service.js";
import { z } from "zod";

const GenderFilterTransactionSchema = z.object({
  amount: z.number().positive(),
  screens: z.number().positive()
});

@Controller()
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  private getTokenFromHeader(h?: string) {
    if (!h) return null;
    const [t, v] = h.split(" ");
    return t?.toLowerCase() === "bearer" ? v : null;
  }

  private async verifyTokenAndGetUserId(token: string): Promise<string> {
    const { verifyToken } = await import("@hmm/common");
    const jwkStr = process.env.JWT_PUBLIC_JWK;
    if (!jwkStr || jwkStr === "undefined") {
      throw new HttpException("Server configuration error", HttpStatus.INTERNAL_SERVER_ERROR);
    }
    const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
    const publicJwk = JSON.parse(cleanedJwk);
    const verifyAccess = await verifyToken(publicJwk);
    const payload = await verifyAccess(token);
    return payload.sub;
  }

  private assertInternalRequest(internalToken?: string) {
    const expectedToken = process.env.INTERNAL_SERVICE_TOKEN;
    if (!expectedToken) {
      throw new HttpException("INTERNAL_SERVICE_TOKEN is not configured", HttpStatus.INTERNAL_SERVER_ERROR);
    }
    if (!internalToken || internalToken !== expectedToken) {
      throw new HttpException("Unauthorized internal request", HttpStatus.UNAUTHORIZED);
    }
  }

  /**
   * Get current user's coin and diamond balance
   * GET /me/balance
   */
  @Get("me/balance")
  async getMyBalance(@Headers("authorization") authz?: string) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const userId = await this.verifyTokenAndGetUserId(token);
    return this.walletService.getBalance(userId);
  }

  /**
   * Purchase diamonds with coins (explicit conversion)
   * POST /me/diamonds/purchase
   * Body: { diamondAmount: number }
   */
  @Post("me/diamonds/purchase")
  async purchaseDiamonds(@Headers("authorization") authz: string, @Body() body: any) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const schema = z.object({
      diamondAmount: z.number().positive().int()
    });
    const dto = schema.parse(body);

    const userId = await this.verifyTokenAndGetUserId(token);
    try {
      return await this.walletService.purchaseDiamondsFromCoins(userId, dto.diamondAmount);
    } catch (error) {
      if (error instanceof Error && error.message.includes("Insufficient coins")) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(
        "Failed to purchase diamonds",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Deduct coins for gender filter purchase
   * POST /me/transactions/gender-filter
   * 
   * Body: { amount: number, screens: number }
   */
  @Post("me/transactions/gender-filter")
  async deductCoinsForGenderFilter(
    @Headers("authorization") authz: string,
    @Body() body: any
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const userId = await this.verifyTokenAndGetUserId(token);
    const dto = GenderFilterTransactionSchema.parse(body);

    try {
      return await this.walletService.deductCoinsForGenderFilter(
        userId,
        dto.amount,
        dto.screens
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("Insufficient balance")) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(
        "Failed to process transaction",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /* ---------- Test Endpoints (No Auth Required) ---------- */

  /**
   * Test endpoint: Get balance (bypasses auth)
   * GET /test/balance?userId=xxx
   */
  @Get("test/balance")
  async getBalanceTest(@Query("userId") userId: string) {
    if (!userId) {
      throw new HttpException("userId is required", HttpStatus.BAD_REQUEST);
    }
    return this.walletService.getBalance(userId);
  }

  /**
   * Test endpoint: Deduct coins for gender filter (bypasses auth)
   * POST /test/transactions/gender-filter
   * Body: { userId: string, amount: number, screens: number }
   */
  @Post("test/transactions/gender-filter")
  async deductCoinsForGenderFilterTest(@Body() body: any) {
    const { userId, amount, screens } = body;
    if (!userId) {
      throw new HttpException("userId is required", HttpStatus.BAD_REQUEST);
    }
    const dto = GenderFilterTransactionSchema.parse({ amount, screens });

    try {
      return await this.walletService.deductCoinsForGenderFilter(
        userId,
        dto.amount,
        dto.screens
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("Insufficient balance")) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(
        "Failed to process transaction",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Test endpoint: Get wallet with transactions (bypasses auth)
   * GET /test/wallet?userId=xxx&includeTransactions=true
   */
  @Get("test/wallet")
  async getWalletTest(@Query("userId") userId: string, @Query("includeTransactions") includeTransactions?: string) {
    if (!userId) {
      throw new HttpException("userId is required", HttpStatus.BAD_REQUEST);
    }
    const include = includeTransactions === "true" || includeTransactions === "1";
    return this.walletService.getWallet(userId, include);
  }

  /**
   * Test endpoint: Add coins to wallet (for testing)
   * POST /test/wallet/add-coins
   * Body: { userId: string, amount: number, description?: string, giftId?: string }
   */
  @Post("test/wallet/add-coins")
  async addCoinsTest(@Body() body: any) {
    const { userId, amount, description, giftId } = body;
    if (!userId || !amount) {
      throw new HttpException("userId and amount are required", HttpStatus.BAD_REQUEST);
    }
    if (amount <= 0) {
      throw new HttpException("Amount must be positive", HttpStatus.BAD_REQUEST);
    }
    return this.walletService.addCoinsForUser(userId, amount, description, giftId);
  }

  /**
   * Test endpoint: Deduct coins for dare payment (for testing)
   * POST /test/transactions/dare-payment
   * Body: { userId: string, amount: number, description?: string }
   */
  @Post("test/transactions/dare-payment")
  async deductCoinsForDarePaymentTest(@Body() body: any) {
    const { userId, amount, description } = body;
    if (!userId || !amount) {
      throw new HttpException("userId and amount are required", HttpStatus.BAD_REQUEST);
    }
    if (amount <= 0) {
      throw new HttpException("Amount must be positive", HttpStatus.BAD_REQUEST);
    }

    try {
      return await this.walletService.deductCoinsForDarePayment(userId, amount, description);
    } catch (error) {
      if (error instanceof Error && error.message.includes("Insufficient balance")) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(
        "Failed to process dare payment transaction",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Test endpoint: Deduct coins from wallet (admin/internal style)
   * POST /test/wallet/deduct-coins
   * Body: { userId: string, amount: number, description?: string }
   */
  @Post("test/wallet/deduct-coins")
  async deductCoinsTest(@Body() body: any) {
    const { userId, amount, description } = body;
    if (!userId || !amount) {
      throw new HttpException("userId and amount are required", HttpStatus.BAD_REQUEST);
    }
    if (amount <= 0) {
      throw new HttpException("Amount must be positive", HttpStatus.BAD_REQUEST);
    }

    try {
      return await this.walletService.deductCoinsForDarePayment(userId, amount, description);
    } catch (error) {
      if (error instanceof Error && error.message.includes("Insufficient balance")) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(
        "Failed to deduct coins",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Test endpoint: Get gift transactions for a user (bypasses auth)
   * GET /test/wallet/gift-transactions?userId=xxx
   */
  @Get("test/wallet/gift-transactions")
  async getGiftTransactionsTest(@Query("userId") userId: string) {
    if (!userId) {
      throw new HttpException("userId is required", HttpStatus.BAD_REQUEST);
    }
    return this.walletService.getGiftTransactions(userId);
  }

  /**
   * Get gift transactions for current user
   * GET /me/transactions/gifts
   */
  @Get("me/transactions/gifts")
  async getMyGiftTransactions(@Headers("authorization") authz?: string) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const userId = await this.verifyTokenAndGetUserId(token);
    return this.walletService.getGiftTransactions(userId);
  }

  /**
   * Test endpoint: Add diamonds (for testing / internal)
   * POST /test/wallet/add-diamonds
   * Body: { userId: string, amount: number, description?: string, giftId?: string }
   */
  @Post("test/wallet/add-diamonds")
  async addDiamondsTest(@Body() body: any) {
    const { userId, amount, description, giftId } = body;
    if (!userId || !amount) {
      throw new HttpException("userId and amount are required", HttpStatus.BAD_REQUEST);
    }
    if (amount <= 0) {
      throw new HttpException("Amount must be positive", HttpStatus.BAD_REQUEST);
    }
    return this.walletService.addDiamondsForUser(userId, amount, description, giftId);
  }

  /**
   * Test endpoint: Deduct diamonds (for testing / internal)
   * POST /test/wallet/deduct-diamonds
   * Body: { userId: string, amount: number, description?: string }
   */
  @Post("test/wallet/deduct-diamonds")
  async deductDiamondsTest(@Body() body: any) {
    const { userId, amount, description } = body;
    if (!userId || !amount) {
      throw new HttpException("userId and amount are required", HttpStatus.BAD_REQUEST);
    }
    if (amount <= 0) {
      throw new HttpException("Amount must be positive", HttpStatus.BAD_REQUEST);
    }
    try {
      return await this.walletService.deductDiamondsForUser(userId, amount, description);
    } catch (error) {
      if (error instanceof Error && error.message.includes("Insufficient diamonds")) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(
        "Failed to deduct diamonds",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Test endpoint: Transfer diamonds (for testing / internal)
   * POST /test/wallet/transfer-diamonds
   * Body: { fromUserId: string, toUserId: string, amount: number, description?: string, giftId?: string }
   */
  @Post("test/wallet/transfer-diamonds")
  async transferDiamondsTest(@Body() body: any) {
    const { fromUserId, toUserId, amount, description, giftId } = body;
    if (!fromUserId || !toUserId || !amount) {
      throw new HttpException("fromUserId, toUserId and amount are required", HttpStatus.BAD_REQUEST);
    }
    if (amount <= 0) {
      throw new HttpException("Amount must be positive", HttpStatus.BAD_REQUEST);
    }
    try {
      return await this.walletService.transferDiamonds(
        fromUserId,
        toUserId,
        amount,
        description,
        giftId
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("Insufficient diamonds")) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(
        "Failed to transfer diamonds",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /* ---------- Internal Endpoints (for other services) ---------- */

  /**
   * Award referral rewards (internal endpoint for user-service)
   * POST /internal/referral-rewards
   * Body: { referrerId: string, referredUserId: string, referrerReward: number, referredReward: number }
   */
  @Post("internal/referral-rewards")
  async awardReferralRewards(@Body() body: any, @Headers("x-internal-token") internalToken?: string) {
    this.assertInternalRequest(internalToken);
    const schema = z.object({
      referrerId: z.string().min(1),
      referredUserId: z.string().min(1),
      referrerReward: z.number().positive(),
      referredReward: z.number().positive()
    });

    const dto = schema.parse(body);

    try {
      return await this.walletService.awardReferralRewards(
        dto.referrerId,
        dto.referredUserId,
        dto.referrerReward,
        dto.referredReward
      );
    } catch (error) {
      throw new HttpException(
        error instanceof Error ? error.message : "Failed to award referral rewards",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}

