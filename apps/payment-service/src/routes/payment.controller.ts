import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
  Query,
  HttpException,
  HttpStatus,
  HttpCode,
  Logger
} from "@nestjs/common";
import { PaymentService } from "../services/payment.service.js";
import { RazorpayService } from "../services/razorpay.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { PaymentConfigService } from "../config/payment.config.js";
import {
  InitiatePurchaseSchema,
  VerifyPaymentSchema,
  PreviewRedemptionSchema,
  InitiateRedemptionSchema,
  HistoryQuerySchema
} from "../dtos/payment.dto.js";
import { verifyToken } from "@hmm/common";

@Controller("v1/payments")
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(
    private readonly paymentService: PaymentService,
    private readonly razorpayService: RazorpayService,
    private readonly prisma: PrismaService,
    private readonly configService: PaymentConfigService
  ) {}

  private getTokenFromHeader(h?: string): string | null {
    if (!h) return null;
    const [t, v] = h.split(" ");
    return t?.toLowerCase() === "bearer" ? v : null;
  }

  private async verifyTokenAndGetUserId(token: string): Promise<string> {
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

  /**
   * Initiate coin purchase
   * POST /v1/payments/purchase/initiate
   */
  @Post("purchase/initiate")
  async initiatePurchase(
    @Headers("authorization") authz?: string,
    @Body() body?: any
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const userId = await this.verifyTokenAndGetUserId(token);
    const dto = InitiatePurchaseSchema.parse(body);

    try {
      const result = await this.paymentService.initiateCoinPurchase(userId, dto.coinsAmount);
      return {
        success: true,
        orderId: result.orderId,
        razorpayOrderId: result.razorpayOrderId,
        amountInr: result.amountInr / 100, // Convert paise to INR
        amountInPaise: result.amountInr,
        razorpayOrder: result.razorpayOrder
      };
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error.message || "Failed to initiate purchase",
        HttpStatus.BAD_REQUEST
      );
    }
  }

  /**
   * Verify payment (frontend callback after payment)
   * POST /v1/payments/purchase/verify
   */
  @Post("purchase/verify")
  @HttpCode(HttpStatus.OK)
  async verifyPayment(
    @Headers("authorization") authz?: string,
    @Body() body?: any
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    await this.verifyTokenAndGetUserId(token); // Verify user is authenticated
    const dto = VerifyPaymentSchema.parse(body);

    try {
      const result = await this.paymentService.handlePaymentSuccess(
        dto.paymentId,
        dto.orderId,
        dto.signature
      );
      return {
        success: true,
        orderId: result.orderId,
        coinsCredited: result.coinsCredited
      };
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error.message || "Payment verification failed",
        HttpStatus.BAD_REQUEST
      );
    }
  }

  /**
   * Get purchase history
   * GET /v1/payments/purchase/orders
   */
  @Get("purchase/orders")
  async getPurchaseHistory(
    @Headers("authorization") authz?: string,
    @Query() query?: any
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const userId = await this.verifyTokenAndGetUserId(token);
    const queryWithDefault = {
      ...query,
      limit: query?.limit ?? String(this.configService.getHistoryDefaultLimit())
    };
    const dto = HistoryQuerySchema.parse(queryWithDefault);

    try {
      const orders = await this.paymentService.getPurchaseHistory(userId, dto.limit);
      return {
        success: true,
        orders: orders.map(order => ({
          id: order.id,
          amountInr: order.amountInr / 100, // Convert paise to INR
          coinsAmount: order.coinsAmount,
          status: order.status,
          razorpayOrderId: order.razorpayOrderId,
          razorpayPaymentId: order.razorpayPaymentId,
          createdAt: order.createdAt,
          completedAt: order.completedAt,
          failureReason: order.failureReason
        }))
      };
    } catch (error: any) {
      throw new HttpException(
        error.message || "Failed to fetch purchase history",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Preview redemption with upsell options
   * POST /v1/payments/redemption/preview
   */
  @Post("redemption/preview")
  async previewRedemption(
    @Headers("authorization") authz?: string,
    @Body() body?: any
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const userId = await this.verifyTokenAndGetUserId(token);
    const dto = PreviewRedemptionSchema.parse(body);

    try {
      const result = await this.paymentService.previewRedemption(userId, dto.baseDiamonds);
      return {
        success: true,
        baseDiamonds: result.baseDiamonds,
        baseInrValue: result.baseInrValue,
        currentDiamonds: result.currentDiamonds,
        upsellOptions: result.upsellOptions.map(option => ({
          level: option.level,
          diamondsRequired: option.diamondsRequired,
          additionalDiamonds: option.additionalDiamonds,
          inrValue: option.inrValue,
          multiplier: option.multiplier,
          coinsNeeded: option.coinsNeeded
        }))
      };
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error.message || "Failed to preview redemption",
        HttpStatus.BAD_REQUEST
      );
    }
  }

  /**
   * Initiate redemption/cashout
   * POST /v1/payments/redemption/initiate
   */
  @Post("redemption/initiate")
  @HttpCode(HttpStatus.OK)
  async initiateRedemption(
    @Headers("authorization") authz?: string,
    @Body() body?: any
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const userId = await this.verifyTokenAndGetUserId(token);
    const dto = InitiateRedemptionSchema.parse(body);

    try {
      const result = await this.paymentService.processRedemptionWithUpsell(
        userId,
        dto.baseDiamonds,
        dto.upsellLevel,
        dto.bankAccountDetails
      );
      return {
        success: true,
        requestId: result.requestId,
        inrAmount: result.inrAmount / 100, // Convert paise to INR
        inrAmountInPaise: result.inrAmount,
        payoutId: result.payoutId
      };
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error.message || "Failed to initiate redemption",
        HttpStatus.BAD_REQUEST
      );
    }
  }

  /**
   * Get redemption history
   * GET /v1/payments/redemption/requests
   */
  @Get("redemption/requests")
  async getRedemptionHistory(
    @Headers("authorization") authz?: string,
    @Query() query?: any
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const userId = await this.verifyTokenAndGetUserId(token);
    const queryWithDefault = {
      ...query,
      limit: query?.limit ?? String(this.configService.getHistoryDefaultLimit())
    };
    const dto = HistoryQuerySchema.parse(queryWithDefault);

    try {
      const requests = await this.paymentService.getRedemptionHistory(userId, dto.limit);
      return {
        success: true,
        requests: requests.map(request => ({
          id: request.id,
          originalDiamonds: request.originalDiamonds,
          finalDiamonds: request.finalDiamonds,
          inrAmount: request.inrAmount / 100, // Convert paise to INR
          upsellLevel: request.upsellLevel,
          status: request.status,
          razorpayPayoutId: request.razorpayPayoutId,
          createdAt: request.createdAt,
          completedAt: request.completedAt,
          failureReason: request.failureReason
        }))
      };
    } catch (error: any) {
      throw new HttpException(
        error.message || "Failed to fetch redemption history",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Readiness check endpoint (database only)
   * GET /v1/payments/ready
   */
  @Get("ready")
  @HttpCode(HttpStatus.OK)
  async readinessCheck() {
    const { HealthChecker } = await import("@hmm/common");
    try {
      const dbCheck = await HealthChecker.checkDatabase(this.prisma, "payment-service");
      
      if (dbCheck.status === 'up') {
        return {
          status: 'ready',
          timestamp: new Date().toISOString()
        };
      } else {
        return {
          status: 'not_ready',
          message: dbCheck.message,
          timestamp: new Date().toISOString()
        };
      }
    } catch (error: any) {
      return {
        status: 'not_ready',
        message: error.message || 'Database check failed',
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Health check endpoint
   * GET /v1/payments/health
   */
  @Get("health")
  @HttpCode(HttpStatus.OK)
  async healthCheck() {
    const { HealthChecker, ServiceDiscovery } = await import("@hmm/common");
    
    const dbCheck = await HealthChecker.checkDatabase(this.prisma, "payment-service");
    
    // Check wallet service dependency
    const discovery = ServiceDiscovery.getInstance();
    const dependencies: {
      [serviceName: string]: {
        status: 'up' | 'down';
        url?: string;
        responseTime?: number;
        error?: string;
      };
    } = {};
    
    try {
      const walletUrl = discovery.getServiceUrl("wallet-service");
      const walletCheck = await HealthChecker.checkService(walletUrl, 1000); // Reduced from 2000ms to 1000ms
      dependencies["wallet-service"] = {
        status: walletCheck.status,
        url: walletUrl,
        responseTime: walletCheck.responseTime,
        error: walletCheck.error
      };
    } catch (error) {
      dependencies["wallet-service"] = {
        status: "down",
        error: error instanceof Error ? error.message : String(error)
      };
    }
    
    return HealthChecker.createResponse(
      "payment-service",
      {
        database: dbCheck
      },
      dependencies,
      process.env.npm_package_version || "0.0.1"
    );
  }

  /* ---------- Test Endpoints (No Auth Required) ---------- */

  /**
   * Test endpoint: Get payment configuration
   * GET /v1/payments/test/config
   */
  @Get("test/config")
  async getTestConfig() {
    return {
      inrPerCoin: this.configService.getInrPerCoin(),
      diamondToCoinRate: this.configService.getDiamondToCoinRate(),
      diamondToInrRate: this.configService.getDiamondToInrRate(),
      minRedemptionDiamonds: this.configService.getMinRedemptionDiamonds(),
      minRedemptionInr: this.configService.getMinRedemptionInr(),
      upsellEnabled: this.configService.isUpsellEnabled(),
      maxUpsellLevels: this.configService.getMaxUpsellLevels(),
      upsellMultipliers: this.configService.getUpsellMultipliers()
    };
  }

  /**
   * Test endpoint: Calculate coins for INR amount
   * POST /v1/payments/test/calculate/coins
   */
  @Post("test/calculate/coins")
  async calculateCoinsForInr(@Body() body: any) {
    const { inrAmount } = body;
    if (!inrAmount || inrAmount <= 0) {
      throw new HttpException("inrAmount must be a positive number", HttpStatus.BAD_REQUEST);
    }

    const coinsAmount = this.configService.calculateCoinsForInr(inrAmount);
    
    return {
      inrAmount,
      coinsAmount
    };
  }

  /**
   * Test endpoint: Calculate INR for coins amount
   * POST /v1/payments/test/calculate/inr
   */
  @Post("test/calculate/inr")
  async calculateInrForCoins(@Body() body: any) {
    const { coinsAmount } = body;
    if (!coinsAmount || coinsAmount <= 0) {
      throw new HttpException("coinsAmount must be a positive number", HttpStatus.BAD_REQUEST);
    }

    const inrAmount = this.configService.calculateInrForCoins(coinsAmount);
    
    return {
      coinsAmount,
      inrAmount
    };
  }

  /**
   * Test endpoint: Calculate diamonds from coins
   * POST /v1/payments/test/calculate/diamonds
   */
  @Post("test/calculate/diamonds")
  async calculateDiamondsFromCoins(@Body() body: any) {
    const { coinsAmount } = body;
    if (!coinsAmount || coinsAmount <= 0) {
      throw new HttpException("coinsAmount must be a positive number", HttpStatus.BAD_REQUEST);
    }

    const diamondsAmount = this.configService.coinsToDiamonds(coinsAmount);
    
    return {
      coinsAmount,
      diamondsAmount
    };
  }

  /**
   * Test endpoint: Calculate INR for diamonds (base rate)
   * POST /v1/payments/test/calculate/diamond-inr
   */
  @Post("test/calculate/diamond-inr")
  async calculateInrForDiamonds(@Body() body: any) {
    const { diamondsAmount } = body;
    if (!diamondsAmount || diamondsAmount <= 0) {
      throw new HttpException("diamondsAmount must be a positive number", HttpStatus.BAD_REQUEST);
    }

    const inrAmount = this.configService.calculateInrForDiamonds(diamondsAmount);
    
    return {
      diamondsAmount,
      inrAmount
    };
  }

  /**
   * Test endpoint: Calculate redemption value with upsell
   * POST /v1/payments/test/calculate/upsell
   */
  @Post("test/calculate/upsell")
  async calculateUpsellValue(@Body() body: any) {
    const { baseDiamonds, upsellLevel } = body;
    
    if (!baseDiamonds || baseDiamonds <= 0) {
      throw new HttpException("baseDiamonds must be a positive number", HttpStatus.BAD_REQUEST);
    }
    
    if (upsellLevel === undefined || upsellLevel < 0 || upsellLevel > 3) {
      throw new HttpException("upsellLevel must be between 0 and 3", HttpStatus.BAD_REQUEST);
    }

    const finalDiamonds = baseDiamonds * (upsellLevel + 1);
    const inrAmount = this.configService.calculateRedemptionValue(finalDiamonds, upsellLevel);
    const multipliers = this.configService.getUpsellMultipliers();
    let multiplier = 1.0;
    for (let i = 1; i <= upsellLevel && i < multipliers.length; i++) {
      multiplier *= multipliers[i];
    }
    
    return {
      baseDiamonds,
      finalDiamonds,
      upsellLevel,
      inrAmount,
      multiplier
    };
  }

  /**
   * Test endpoint: Preview redemption with upsell (no wallet service required)
   * POST /v1/payments/test/redemption/preview
   */
  @Post("test/redemption/preview")
  async previewRedemptionTest(@Body() body: any) {
    const { baseDiamonds, availableDiamonds } = body;
    // userId is accepted but not used in test endpoint (no wallet service call needed)

    if (!baseDiamonds || baseDiamonds <= 0) {
      throw new HttpException("baseDiamonds must be a positive number", HttpStatus.BAD_REQUEST);
    }

    if (availableDiamonds === undefined || availableDiamonds < 0) {
      throw new HttpException("availableDiamonds must be provided and non-negative", HttpStatus.BAD_REQUEST);
    }
    
    // Validate minimum redemption
    const minDiamonds = this.configService.getMinRedemptionDiamonds();
    if (baseDiamonds < minDiamonds) {
      throw new HttpException(
        `Minimum redemption is ${minDiamonds} diamonds. You requested ${baseDiamonds}`,
        HttpStatus.BAD_REQUEST
      );
    }

    // Check if user has enough diamonds
    if (availableDiamonds < baseDiamonds) {
      throw new HttpException(
        `Insufficient diamonds. Available: ${availableDiamonds}, Required: ${baseDiamonds}`,
        HttpStatus.BAD_REQUEST
      );
    }

    // Calculate base INR value
    const baseInrValue = this.configService.calculateInrForDiamonds(baseDiamonds);

    // Generate upsell options
    const maxLevels = this.configService.getMaxUpsellLevels();
    const multipliers = this.configService.getUpsellMultipliers();
    const upsellOptions: any[] = [];

    // Level 0: No upsell
    upsellOptions.push({
      level: 0,
      diamondsRequired: baseDiamonds,
      additionalDiamonds: 0,
      inrValue: baseInrValue,
      multiplier: multipliers[0] || 1.0,
      coinsNeeded: 0
    });

    // Calculate upsell levels
    for (let level = 1; level <= maxLevels; level++) {
      const diamondsForThisLevel = baseDiamonds * (level + 1);
      const additionalDiamonds = diamondsForThisLevel - baseDiamonds;
      
      let coinsNeeded = 0;
      if (availableDiamonds < diamondsForThisLevel) {
        const diamondsNeeded = diamondsForThisLevel - availableDiamonds;
        coinsNeeded = this.configService.diamondsToCoins(diamondsNeeded);
      }
      
      let multiplier = 1.0;
      for (let i = 1; i <= level && i < multipliers.length; i++) {
        multiplier *= multipliers[i];
      }
      
      const inrValue = this.configService.calculateRedemptionValue(diamondsForThisLevel, level);

      upsellOptions.push({
        level,
        diamondsRequired: diamondsForThisLevel,
        additionalDiamonds,
        inrValue,
        multiplier,
        coinsNeeded
      });
    }

    return {
      baseDiamonds,
      baseInrValue,
      currentDiamonds: availableDiamonds,
      upsellOptions
    };
  }

  /**
   * Razorpay webhook endpoint (public, no auth required)
   * POST /v1/payments/webhooks/razorpay
   */
  @Post("webhooks/razorpay")
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Headers("x-razorpay-signature") signature?: string,
    @Body() body?: any
  ) {
    if (!signature) {
      throw new HttpException("Missing webhook signature", HttpStatus.BAD_REQUEST);
    }

    // Get raw body as string for signature verification
    const rawBody = JSON.stringify(body);
    const eventType = body?.event || "unknown";

    // Verify webhook signature
    const isValid = this.razorpayService.verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      throw new HttpException("Invalid webhook signature", HttpStatus.UNAUTHORIZED);
    }

    // Generate unique identifier for webhook idempotency check
    const eventId = this.getWebhookEventId(body);
    
    // Check if this webhook was already processed (idempotency check)
    // For payment events, check if payment ID already processed
    if (eventId && (eventType.startsWith("payment."))) {
      const existingOrder = await this.prisma.paymentOrder.findFirst({
        where: {
          razorpayPaymentId: eventId,
          status: "COMPLETED"
        }
      });
      
      if (existingOrder) {
        // Payment already processed, check if we have webhook log
        const existingWebhook = await this.prisma.paymentWebhook.findFirst({
          where: {
            eventType: eventType,
            status: { in: ["PROCESSED", "PROCESSING"] as any }
          },
          orderBy: { createdAt: "desc" }
        });
        
        return { 
          success: true, 
          message: "Webhook already processed (payment already completed)",
          webhookId: existingWebhook?.id || "unknown"
        };
      }
    }
    
    // For payout events, check if payout ID already processed
    if (eventId && (eventType.startsWith("payout."))) {
      const existingRequest = await this.prisma.redemptionRequest.findFirst({
        where: {
          razorpayPayoutId: eventId,
          status: { in: ["COMPLETED", "FAILED"] }
        }
      });
      
      if (existingRequest) {
        return { 
          success: true, 
          message: "Webhook already processed (payout already processed)",
          webhookId: "unknown"
        };
      }
    }

    // Log webhook
    const webhook = await this.prisma.paymentWebhook.create({
      data: {
        eventType: eventType,
        payload: body as any,
        signature: signature,
        status: "PENDING" as any
      }
    });

    // Process webhook asynchronously (don't block response)
    this.processWebhookAsync(webhook.id, body).catch((error) => {
      console.error(`Failed to process webhook ${webhook.id}:`, error);
    });

    // Return 200 immediately (Razorpay expects quick response)
    return { success: true, message: "Webhook received", webhookId: webhook.id };
  }

  /**
   * Process webhook asynchronously
   * Uses additional idempotency checks to prevent duplicate processing
   */
  private async processWebhookAsync(webhookId: string, payload: any): Promise<void> {
    try {
      const eventType = payload?.event;
      
      // Update webhook status to PROCESSING (prevents concurrent processing)
      await this.prisma.paymentWebhook.update({
        where: { id: webhookId },
        data: { status: "PROCESSING" as any }
      });

      // Handle payment events
      if (eventType === "payment.captured" || eventType === "payment.authorized") {
        const payment = payload?.payload?.payment?.entity;
        if (payment?.order_id && payment?.id) {
          // Additional idempotency check: verify payment ID hasn't been processed
          const existingOrder = await this.prisma.paymentOrder.findFirst({
            where: {
              razorpayPaymentId: payment.id,
              status: "COMPLETED"
            }
          });

          if (existingOrder) {
            this.logger.log(`Payment ${payment.id} already processed for order ${existingOrder.id}, skipping`);
          } else {
            // Find order by Razorpay order ID
            const order = await this.prisma.paymentOrder.findFirst({
              where: { razorpayOrderId: payment.order_id }
            });

            if (order && order.status === "PENDING") {
              // For webhook, signature is already verified at webhook level
              // Process payment with signature verification skipped
              try {
                await this.paymentService.handlePaymentSuccess(
                  payment.id,
                  order.razorpayOrderId || payment.order_id,
                  "", // Not needed since webhook signature is verified
                  true // Skip signature verification
                );
              } catch (error: any) {
                this.logger.error(`Failed to process payment from webhook: ${error.message}`);
                // Don't throw - webhook should return 200 even if processing fails
              }
            } else if (order && order.status !== "PENDING") {
              this.logger.log(`Order ${order.id} already processed (status: ${order.status}), skipping webhook processing`);
            }
          }
        }
      }

      // Handle payout events
      if (eventType === "payout.processed" || eventType === "payout.failed") {
        const payout = payload?.payload?.payout?.entity;
        if (payout?.id) {
          // Additional idempotency check: verify payout hasn't been processed
          const redemptionRequest = await this.prisma.redemptionRequest.findFirst({
            where: { 
              razorpayPayoutId: payout.id
            }
          });

          if (redemptionRequest) {
            // Check if already in target status
            if (redemptionRequest.status === "COMPLETED" && eventType === "payout.processed") {
              this.logger.log(`Payout ${payout.id} already processed for redemption ${redemptionRequest.id}, skipping`);
            } else if (redemptionRequest.status !== "COMPLETED" && redemptionRequest.status !== "FAILED") {
              // Use transaction to update status atomically
              await this.prisma.$transaction(async (tx) => {
                // Reload with lock to prevent race conditions
                const request = await tx.redemptionRequest.findUnique({
                  where: { id: redemptionRequest.id }
                });

                if (request && request.status !== "COMPLETED" && request.status !== "FAILED") {
                  await tx.redemptionRequest.update({
                    where: { id: redemptionRequest.id },
                    data: {
                      status: eventType === "payout.processed" ? "COMPLETED" : "FAILED",
                      completedAt: eventType === "payout.processed" ? new Date() : undefined,
                      failureReason: eventType === "payout.failed" ? payout.failure_reason : undefined
                    }
                  });
                }
              });
            }
          }
        }
      }

      // Mark webhook as processed
      await this.prisma.paymentWebhook.update({
        where: { id: webhookId },
        data: {
          status: "PROCESSED" as any,
          processedAt: new Date()
        }
      });
    } catch (error: any) {
      // Mark webhook as failed
      await this.prisma.paymentWebhook.update({
        where: { id: webhookId },
        data: {
          status: "FAILED" as any,
          errorMessage: error.message
        }
      });
      this.logger.error(`Webhook processing failed for ${webhookId}: ${error.message}`);
      // Don't throw - we've already logged and marked as failed
    }
  }

  /**
   * Extract event ID from webhook payload for idempotency checking
   */
  private getWebhookEventId(body: any): string | null {
    try {
      // Try to get payment ID
      if (body?.payload?.payment?.entity?.id) {
        return body.payload.payment.entity.id;
      }
      // Try to get payout ID
      if (body?.payload?.payout?.entity?.id) {
        return body.payload.payout.entity.id;
      }
      // Try to get order ID
      if (body?.payload?.order?.entity?.id) {
        return body.payload.order.entity.id;
      }
      return null;
    } catch {
      return null;
    }
  }
}
