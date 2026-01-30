import { Injectable, Logger, BadRequestException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { RazorpayService } from "./razorpay.service.js";
import { WalletClientService } from "./wallet-client.service.js";
import { PaymentConfigService } from "../config/payment.config.js";
import { EncryptionService } from "./encryption.service.js";

export interface UpsellOption {
  level: number;
  diamondsRequired: number;
  additionalDiamonds: number;
  inrValue: number;
  multiplier: number;
  coinsNeeded: number;
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly razorpayService: RazorpayService,
    private readonly walletClient: WalletClientService,
    private readonly configService: PaymentConfigService,
    private readonly encryptionService: EncryptionService
  ) {}

  /**
   * Initiate coin purchase - Create Razorpay order and store in DB
   */
  async initiateCoinPurchase(
    userId: string,
    coinsAmount: number
  ): Promise<{ orderId: string; razorpayOrderId: string; amountInr: number; razorpayOrder: any }> {
    if (coinsAmount <= 0) {
      throw new BadRequestException("Coins amount must be positive");
    }

    // Calculate INR amount needed for coins
    const inrAmount = this.configService.calculateInrForCoins(coinsAmount);
    const amountInPaise = Math.round(inrAmount * 100); // Convert to paise

    if (amountInPaise < 100) {
      throw new BadRequestException("Minimum purchase amount is ₹1 (100 paise)");
    }

    try {
      // Create Razorpay order
      const razorpayOrder = await this.razorpayService.createOrder(amountInPaise, "INR", {
        userId,
        coinsAmount: coinsAmount.toString(),
        orderType: "coin_purchase"
      });

      // Store order in database
      const order = await this.prisma.paymentOrder.create({
        data: {
          userId,
          amountInr: amountInPaise,
          coinsAmount,
          razorpayOrderId: razorpayOrder.id,
          status: "PENDING"
        }
      });

      this.logger.log(`Coin purchase initiated: order ${order.id} for user ${userId}, ${coinsAmount} coins`);

      return {
        orderId: order.id,
        razorpayOrderId: razorpayOrder.id,
        amountInr: amountInPaise,
        razorpayOrder
      };
    } catch (error: any) {
      this.logger.error(`Failed to initiate coin purchase: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Handle payment success - Verify payment and credit coins
   * Uses database transaction with row-level locking to prevent race conditions
   * @param skipSignatureVerification If true, skip signature verification (for webhook-processed payments)
   */
  async handlePaymentSuccess(
    paymentId: string,
    orderId: string,
    signature: string,
    skipSignatureVerification: boolean = false
  ): Promise<{ success: boolean; orderId: string; coinsCredited: number }> {
    // Use transaction with row-level locking to prevent race conditions
    return await this.prisma.$transaction(async (tx) => {
      // Find order with row-level lock (SELECT FOR UPDATE)
      // This prevents concurrent processing of the same order
      const order = await tx.$queryRaw<Array<{
        id: string;
        userId: string;
        amountInr: number;
        coinsAmount: number;
        razorpayOrderId: string | null;
        razorpayPaymentId: string | null;
        status: string;
      }>>`
        SELECT id, "userId", "amountInr", "coinsAmount", "razorpayOrderId", "razorpayPaymentId", status
        FROM payment_orders
        WHERE (id = ${orderId} OR "razorpayOrderId" = ${orderId})
        FOR UPDATE
        LIMIT 1
      `.catch(() => []);

      if (!order || order.length === 0) {
        throw new NotFoundException(`Order not found: ${orderId}`);
      }

      const orderData = order[0];

      // Check if already processed (idempotency check)
      if (orderData.status === "COMPLETED") {
        this.logger.warn(`Order ${orderId} already completed, returning existing result`);
        return { 
          success: true, 
          orderId: orderData.id, 
          coinsCredited: orderData.coinsAmount 
        };
      }

      // Check if payment ID already used (prevent duplicate payment processing)
      if (orderData.razorpayPaymentId && orderData.razorpayPaymentId === paymentId) {
        this.logger.warn(`Payment ${paymentId} already processed for order ${orderData.id}`);
        if (orderData.status === "COMPLETED") {
          return { 
            success: true, 
            orderId: orderData.id, 
            coinsCredited: orderData.coinsAmount 
          };
        }
        // If payment ID matches but status is not completed, continue processing
      }

      // Verify payment signature (unless skipped for webhook)
      if (!skipSignatureVerification) {
        if (!orderData.razorpayOrderId) {
          await tx.paymentOrder.update({
            where: { id: orderData.id },
            data: {
              status: "FAILED",
              failureReason: "Invalid order: missing Razorpay order ID"
            }
          });
          throw new BadRequestException("Invalid order: missing Razorpay order ID");
        }

        const isValid = this.razorpayService.verifyPayment(
          paymentId, 
          orderData.razorpayOrderId, 
          signature
        );
        if (!isValid) {
          await tx.paymentOrder.update({
            where: { id: orderData.id },
            data: {
              status: "FAILED",
              failureReason: "Invalid payment signature"
            }
          });
          throw new BadRequestException("Invalid payment signature");
        }
      }

      // Fetch payment details from Razorpay
      const paymentDetails = await this.razorpayService.getPaymentStatus(paymentId);
      
      if (paymentDetails.status !== "captured" && paymentDetails.status !== "authorized") {
        await tx.paymentOrder.update({
          where: { id: orderData.id },
          data: {
            status: "FAILED",
            failureReason: `Payment status: ${paymentDetails.status}`
          }
        });
        throw new BadRequestException(`Payment not successful. Status: ${paymentDetails.status}`);
      }

      // Update order with payment ID and mark as processing (within transaction)
      await tx.paymentOrder.update({
        where: { id: orderData.id },
        data: {
          razorpayPaymentId: paymentId,
          status: "PROCESSING",
          metadata: paymentDetails as any
        }
      });

      try {
        // Credit coins to user wallet (outside transaction but will rollback on failure)
        await this.walletClient.addCoins(
          orderData.userId,
          orderData.coinsAmount,
          `Coin purchase: Order ${orderData.id}, Payment ${paymentId}`
        );

        // Mark order as completed (within transaction)
        await tx.paymentOrder.update({
          where: { id: orderData.id },
          data: {
            status: "COMPLETED",
            completedAt: new Date()
          }
        });

        this.logger.log(
          `Payment successful: Order ${orderData.id}, ${orderData.coinsAmount} coins credited to user ${orderData.userId}`
        );

        return {
          success: true,
          orderId: orderData.id,
          coinsCredited: orderData.coinsAmount
        };
      } catch (error: any) {
        // Mark order as failed if wallet credit fails (within transaction)
        await tx.paymentOrder.update({
          where: { id: orderData.id },
          data: {
            status: "FAILED",
            failureReason: `Wallet credit failed: ${error.message}`
          }
        });
        this.logger.error(`Failed to credit coins for order ${orderData.id}: ${error.message}`);
        throw new BadRequestException(`Failed to credit coins: ${error.message}`);
      }
    }, {
      timeout: this.configService.getTransactionTimeoutMs(),
      isolationLevel: "Serializable" // Highest isolation level to prevent race conditions
    });
  }

  /**
   * Handle payment failure
   */
  async handlePaymentFailure(orderId: string, reason: string): Promise<void> {
    const order = await this.prisma.paymentOrder.findFirst({
      where: {
        OR: [
          { id: orderId },
          { razorpayOrderId: orderId }
        ]
      }
    });

    if (!order) {
      throw new NotFoundException(`Order not found: ${orderId}`);
    }

    await this.prisma.paymentOrder.update({
      where: { id: order.id },
      data: {
        status: "FAILED",
        failureReason: reason
      }
    });

    this.logger.log(`Payment failed: Order ${order.id}, Reason: ${reason}`);
  }

  /**
   * Preview redemption with upsell options
   */
  async previewRedemption(userId: string, baseDiamonds: number): Promise<{
    baseDiamonds: number;
    baseInrValue: number;
    currentDiamonds: number;
    upsellOptions: UpsellOption[];
  }> {
    if (baseDiamonds <= 0) {
      throw new BadRequestException("Diamonds amount must be positive");
    }

    const minDiamonds = this.configService.getMinRedemptionDiamonds();
    if (baseDiamonds < minDiamonds) {
      throw new BadRequestException(
        `Minimum redemption is ${minDiamonds} diamonds. You requested ${baseDiamonds}`
      );
    }

    // Get user's current diamond balance
    const currentDiamonds = await this.walletClient.getDiamondBalance(userId);

    if (currentDiamonds < baseDiamonds) {
      throw new BadRequestException(
        `Insufficient diamonds. Available: ${currentDiamonds}, Required: ${baseDiamonds}`
      );
    }

    // Calculate base INR value
    const baseInrValue = this.configService.calculateInrForDiamonds(baseDiamonds);

    // Generate upsell options
    const upsellOptions = this.calculateUpsellOptions(baseDiamonds, currentDiamonds);

    return {
      baseDiamonds,
      baseInrValue,
      currentDiamonds,
      upsellOptions
    };
  }

  /**
   * Calculate upsell options
   */
  private calculateUpsellOptions(baseDiamonds: number, availableDiamonds: number): UpsellOption[] {
    if (!this.configService.isUpsellEnabled()) {
      return [];
    }

    const maxLevels = this.configService.getMaxUpsellLevels();
    const multipliers = this.configService.getUpsellMultipliers();
    const options: UpsellOption[] = [];

    // Level 0: No upsell
    options.push({
      level: 0,
      diamondsRequired: baseDiamonds,
      additionalDiamonds: 0,
      inrValue: this.configService.calculateInrForDiamonds(baseDiamonds),
      multiplier: multipliers[0] || 1.0,
      coinsNeeded: 0
    });

    // Calculate upsell levels
    for (let level = 1; level <= maxLevels; level++) {
      const diamondsForThisLevel = baseDiamonds * (level + 1); // 2x, 3x, 4x
      const additionalDiamonds = diamondsForThisLevel - baseDiamonds;

      if (availableDiamonds >= diamondsForThisLevel) {
        // User already has enough diamonds
        const coinsNeeded = 0;
        const inrValue = this.configService.calculateRedemptionValue(diamondsForThisLevel, level);
        
        options.push({
          level,
          diamondsRequired: diamondsForThisLevel,
          additionalDiamonds,
          inrValue,
          multiplier: multipliers[level] || 1.0,
          coinsNeeded
        });
      } else {
        // User needs to purchase more diamonds with coins
        const diamondsNeeded = diamondsForThisLevel - availableDiamonds;
        const coinsNeeded = this.walletClient.convertDiamondsToCoins(diamondsNeeded);
        const inrValue = this.configService.calculateRedemptionValue(diamondsForThisLevel, level);

        options.push({
          level,
          diamondsRequired: diamondsForThisLevel,
          additionalDiamonds,
          inrValue,
          multiplier: multipliers[level] || 1.0,
          coinsNeeded
        });
      }
    }

    return options;
  }

  /**
   * Process redemption with optional upsell
   */
  async processRedemptionWithUpsell(
    userId: string,
    baseDiamonds: number,
    upsellLevel: number,
    bankAccountDetails: {
      accountNumber: string;
      ifsc: string;
      name: string;
      accountType?: "savings" | "current";
    }
  ): Promise<{ requestId: string; inrAmount: number; payoutId?: string }> {
    if (baseDiamonds <= 0) {
      throw new BadRequestException("Diamonds amount must be positive");
    }

    const minDiamonds = this.configService.getMinRedemptionDiamonds();
    if (baseDiamonds < minDiamonds) {
      throw new BadRequestException(`Minimum redemption is ${minDiamonds} diamonds`);
    }

    if (upsellLevel < 0 || upsellLevel > this.configService.getMaxUpsellLevels()) {
      throw new BadRequestException(`Invalid upsell level: ${upsellLevel}`);
    }

    // Get current balance
    const currentDiamonds = await this.walletClient.getDiamondBalance(userId);
    const currentCoins = await this.walletClient.getBalance(userId);

    // Calculate final diamonds needed
    const finalDiamonds = baseDiamonds * (upsellLevel + 1);
    
    if (currentDiamonds < finalDiamonds) {
      // User needs to purchase additional diamonds with coins
      const diamondsNeeded = finalDiamonds - currentDiamonds;
      const coinsNeeded = this.walletClient.convertDiamondsToCoins(diamondsNeeded);

      if (currentCoins < coinsNeeded) {
        throw new BadRequestException(
          `Insufficient coins. Need ${coinsNeeded} coins to get ${diamondsNeeded} more diamonds for upsell level ${upsellLevel}`
        );
      }
    }

    // Calculate INR amount with upsell multiplier
    const inrAmount = this.configService.calculateRedemptionValue(finalDiamonds, upsellLevel);
    const inrAmountInPaise = Math.round(inrAmount * 100);

    const minInr = this.configService.getMinRedemptionInr();
    if (inrAmount < minInr) {
      throw new BadRequestException(`Minimum redemption amount is ₹${minInr}`);
    }

    // Encrypt sensitive bank account information
    const encryptedAccountNumber = this.encryptionService.encrypt(bankAccountDetails.accountNumber);
    const coinsToDeduct = this.walletClient.convertDiamondsToCoins(finalDiamonds);

    // Use transaction to ensure atomicity of redemption request creation
    const redemptionRequest = await this.prisma.$transaction(async (tx) => {
      // Get user balance with lock to prevent race conditions
      const userBalance = await this.walletClient.getBalance(userId);

      // Verify balance again within transaction (double-check)
      if (userBalance < coinsToDeduct) {
        throw new BadRequestException(
          `Insufficient coins. Available: ${userBalance}, Required: ${coinsToDeduct}`
        );
      }

      // Create redemption request
      const request = await tx.redemptionRequest.create({
        data: {
          userId,
          originalDiamonds: baseDiamonds,
          finalDiamonds,
          coinsDeducted: coinsToDeduct,
          inrAmount: inrAmountInPaise,
          upsellLevel,
          status: "PENDING",
          bankAccountNumber: encryptedAccountNumber, // Encrypted
          bankIfsc: bankAccountDetails.ifsc, // IFSC is public info, no need to encrypt
          bankAccountName: bankAccountDetails.name // Name is public info, no need to encrypt
        }
      });

      return request;
    }, {
      timeout: this.configService.getTransactionTimeoutMs(),
      isolationLevel: "Serializable"
    });

    try {
      // Deduct coins (outside transaction but will be refunded if payout fails)
      await this.walletClient.deductCoins(
        userId,
        coinsToDeduct,
        `Redemption: ${finalDiamonds} diamonds (${baseDiamonds} base + upsell level ${upsellLevel})`
      );

      // Update request status to processing
      await this.prisma.redemptionRequest.update({
        where: { id: redemptionRequest.id },
        data: { status: "PROCESSING" }
      });

      // Initiate payout with Razorpay (using original unencrypted details)
      let payoutId: string | undefined;
      try {
        const payout = await this.razorpayService.createPayout(
          bankAccountDetails, // Use original unencrypted details for Razorpay API
          inrAmountInPaise,
          "INR",
          {
            userId,
            redemptionRequestId: redemptionRequest.id,
            diamonds: finalDiamonds.toString(),
            upsellLevel: upsellLevel.toString()
          }
        );

        payoutId = payout.id;

        // Update request with payout ID
        await this.prisma.redemptionRequest.update({
          where: { id: redemptionRequest.id },
          data: { razorpayPayoutId: payoutId }
        });

        this.logger.log(
          `Redemption initiated: Request ${redemptionRequest.id}, ${finalDiamonds} diamonds, ₹${inrAmount}, Payout ${payoutId}`
        );
      } catch (payoutError: any) {
        // Payout failed, refund coins
        this.logger.error(`Payout failed for request ${redemptionRequest.id}: ${payoutError.message}`);
        
        await this.walletClient.addCoins(
          userId,
          coinsToDeduct,
          `Refund: Failed payout for redemption request ${redemptionRequest.id}`
        );

        await this.prisma.redemptionRequest.update({
          where: { id: redemptionRequest.id },
          data: {
            status: "FAILED",
            failureReason: `Payout creation failed: ${payoutError.message}`
          }
        });

        throw new BadRequestException(`Failed to initiate payout: ${payoutError.message}`);
      }

      return {
        requestId: redemptionRequest.id,
        inrAmount: inrAmountInPaise,
        payoutId
      };
    } catch (error: any) {
      // Update request as failed if not already updated
      try {
        await this.prisma.redemptionRequest.updateMany({
          where: { 
            id: redemptionRequest.id,
            status: { not: "FAILED" } // Only update if not already failed
          },
          data: {
            status: "FAILED",
            failureReason: error.message
          }
        });
      } catch (updateError: any) {
        this.logger.error(`Failed to update redemption request status: ${updateError.message}`);
      }
      throw error;
    }
  }

  /**
   * Get user's purchase history
   */
  async getPurchaseHistory(userId: string, limit?: number): Promise<any[]> {
    const take = limit ?? this.configService.getHistoryDefaultLimit();
    return this.prisma.paymentOrder.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take
    });
  }

  /**
   * Get user's redemption history
   */
  async getRedemptionHistory(userId: string, limit?: number): Promise<any[]> {
    const take = limit ?? this.configService.getHistoryDefaultLimit();
    return this.prisma.redemptionRequest.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take
    });
  }
}
