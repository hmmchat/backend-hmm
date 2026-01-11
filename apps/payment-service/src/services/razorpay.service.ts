import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import Razorpay from "razorpay";
import crypto from "crypto";
import { PaymentConfigService } from "../config/payment.config.js";

@Injectable()
export class RazorpayService {
  private readonly logger = new Logger(RazorpayService.name);
  private razorpay: Razorpay | null = null;

  constructor(private readonly configService: PaymentConfigService) {
    // Lazy initialization - only initialize when actually needed (not for test endpoints)
    // This allows the service to start without Razorpay keys for testing
  }

  /**
   * Get or initialize Razorpay client (lazy initialization)
   */
  private getRazorpayClient(): Razorpay {
    if (!this.razorpay) {
      const keyId = this.configService.getRazorpayKeyId();
      const keySecret = this.configService.getRazorpayKeySecret();

      this.razorpay = new Razorpay({
        key_id: keyId,
        key_secret: keySecret
      });

      this.logger.log("Razorpay client initialized");
    }
    return this.razorpay;
  }

  /**
   * Create a Razorpay order for coin purchase
   * @param amount Amount in INR (paise, e.g., 10000 = ₹100)
   * @param currency Currency code (default: INR)
   * @param notes Additional notes/metadata
   * @returns Razorpay order object
   */
  async createOrder(
    amount: number,
    currency: string = "INR",
    notes: Record<string, string> = {}
  ): Promise<any> {
    try {
      const razorpay = this.getRazorpayClient();
      const options = {
        amount: amount, // Amount in paise
        currency: currency,
        receipt: `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        notes: notes
      };

      const order = await razorpay.orders.create(options);
      this.logger.log(`Razorpay order created: ${order.id}`);
      return order;
    } catch (error: any) {
      this.logger.error(`Failed to create Razorpay order: ${error.message}`, error.stack);
      throw new BadRequestException(`Failed to create payment order: ${error.message}`);
    }
  }

  /**
   * Verify payment signature
   * @param paymentId Razorpay payment ID
   * @param orderId Razorpay order ID
   * @param signature Payment signature from Razorpay
   * @returns true if signature is valid
   */
  verifyPayment(paymentId: string, orderId: string, signature: string): boolean {
    try {
      const text = `${orderId}|${paymentId}`;
      
      // For payment verification, we use the key secret directly
      const keySecret = this.configService.getRazorpayKeySecret();
      const expectedSignature = crypto
        .createHmac("sha256", keySecret)
        .update(text)
        .digest("hex");

      const isValid = expectedSignature === signature;
      
      if (!isValid) {
        this.logger.warn(`Invalid payment signature for payment ${paymentId}`);
      }

      return isValid;
    } catch (error: any) {
      this.logger.error(`Error verifying payment signature: ${error.message}`);
      return false;
    }
  }

  /**
   * Get payment details from Razorpay
   * @param paymentId Razorpay payment ID
   * @returns Payment details
   */
  async getPaymentStatus(paymentId: string): Promise<any> {
    try {
      const razorpay = this.getRazorpayClient();
      const payment = await razorpay.payments.fetch(paymentId);
      return payment;
    } catch (error: any) {
      this.logger.error(`Failed to fetch payment ${paymentId}: ${error.message}`);
      throw new BadRequestException(`Failed to fetch payment status: ${error.message}`);
    }
  }

  /**
   * Create a payout (for redemption/cashout)
   * @param accountDetails Bank account details
   * @param amount Amount in INR (paise)
   * @param currency Currency code (default: INR)
   * @param notes Additional notes/metadata
   * @returns Razorpay payout object
   */
  async createPayout(
    accountDetails: {
      accountNumber: string;
      ifsc: string;
      name: string;
      accountType?: "savings" | "current";
    },
    amount: number,
    currency: string = "INR",
    notes: Record<string, string> = {}
  ): Promise<any> {
    try {
      const razorpay = this.getRazorpayClient() as any; // Type assertion for Razorpay SDK
      
      // First, create a contact in Razorpay (required for payout)
      const contact = await razorpay.contacts.create({
        name: accountDetails.name,
        type: "customer",
        notes: {
          ...notes,
          accountNumber: accountDetails.accountNumber,
          ifsc: accountDetails.ifsc
        }
      });

      // Create a fund account (bank account)
      const fundAccount = await razorpay.fundAccounts.create({
        contact_id: contact.id,
        account_type: accountDetails.accountType || "savings",
        bank_account: {
          name: accountDetails.name,
          ifsc: accountDetails.ifsc,
          account_number: accountDetails.accountNumber
        }
      });

      // Create the payout
      const payout = await razorpay.payouts.create({
        account_number: process.env.RAZORPAY_ACCOUNT_NUMBER || "", // Your Razorpay account number
        fund_account_id: fundAccount.id,
        amount: amount,
        currency: currency,
        mode: "IMPS", // or "NEFT", "RTGS"
        purpose: "payout",
        queue_if_low_balance: true,
        reference_id: `payout_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        notes: notes
      });

      this.logger.log(`Razorpay payout created: ${payout.id}`);
      return payout;
    } catch (error: any) {
      this.logger.error(`Failed to create Razorpay payout: ${error.message}`, error.stack);
      throw new BadRequestException(`Failed to create payout: ${error.message}`);
    }
  }

  /**
   * Get payout details from Razorpay
   * @param payoutId Razorpay payout ID
   * @returns Payout details
   */
  async getPayoutStatus(payoutId: string): Promise<any> {
    try {
      const razorpay = this.getRazorpayClient() as any; // Type assertion for Razorpay SDK
      const payout = await razorpay.payouts.fetch(payoutId);
      return payout;
    } catch (error: any) {
      this.logger.error(`Failed to fetch payout ${payoutId}: ${error.message}`);
      throw new BadRequestException(`Failed to fetch payout status: ${error.message}`);
    }
  }

  /**
   * Verify webhook signature from Razorpay
   * @param payload Webhook payload (as string)
   * @param signature Webhook signature header
   * @returns true if signature is valid
   */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    try {
      const webhookSecret = this.configService.getRazorpayWebhookSecret();
      const expectedSignature = crypto
        .createHmac("sha256", webhookSecret)
        .update(payload)
        .digest("hex");

      const isValid = expectedSignature === signature;
      
      if (!isValid) {
        this.logger.warn(`Invalid webhook signature: expected ${expectedSignature}, got ${signature}`);
      }

      return isValid;
    } catch (error: any) {
      this.logger.error(`Error verifying webhook signature: ${error.message}`);
      return false;
    }
  }

  /**
   * Get Razorpay instance (for advanced operations if needed)
   */
  getRazorpayInstance(): any {
    return this.getRazorpayClient();
  }
}
