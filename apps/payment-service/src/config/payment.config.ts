import { Injectable } from "@nestjs/common";

@Injectable()
export class PaymentConfigService {
  // Coin Purchase (INR → Coins)
  // 1 INR = 100 coins by default (INR_PER_COIN = 0.01 means 0.01 INR per coin)
  getInrPerCoin(): number {
    return parseFloat(process.env.INR_PER_COIN || "0.01");
  }

  // Calculate how many coins user gets for given INR amount
  calculateCoinsForInr(inrAmount: number): number {
    const inrPerCoin = this.getInrPerCoin();
    return Math.floor(inrAmount / inrPerCoin);
  }

  // Calculate INR amount needed for given coins
  calculateInrForCoins(coins: number): number {
    const inrPerCoin = this.getInrPerCoin();
    return Math.ceil(coins * inrPerCoin * 100) / 100; // Round to 2 decimal places
  }

  // Coin ↔ Diamond Conversion
  // 1 diamond = 50 coins by default (existing rate from wallet-service)
  getDiamondToCoinRate(): number {
    return parseInt(process.env.DIAMOND_TO_COIN_RATE || "50", 10);
  }

  // Convert diamonds to coins
  diamondsToCoins(diamonds: number): number {
    return diamonds * this.getDiamondToCoinRate();
  }

  // Convert coins to diamonds (floor to avoid partial diamonds)
  coinsToDiamonds(coins: number): number {
    return Math.floor(coins / this.getDiamondToCoinRate());
  }

  // Diamond → INR (Base Rate)
  // 1 diamond = 0.4 INR by default (configurable)
  getDiamondToInrRate(): number {
    return parseFloat(process.env.DIAMOND_TO_INR_RATE || "0.4");
  }

  // Calculate INR value for diamonds (base rate, before upsell)
  calculateInrForDiamonds(diamonds: number): number {
    return diamonds * this.getDiamondToInrRate();
  }

  // Upsell Configuration
  isUpsellEnabled(): boolean {
    return process.env.UPSELL_ENABLED !== "false";
  }

  getMaxUpsellLevels(): number {
    return parseInt(process.env.UPSELL_LEVELS || "3", 10);
  }

  // Get upsell multipliers for each level (0 = no upsell, 1-3 = upsell levels)
  getUpsellMultipliers(): number[] {
    const level1 = parseFloat(process.env.UPSELL_MULTIPLIER_LEVEL_1 || "2.0");
    const level2 = parseFloat(process.env.UPSELL_MULTIPLIER_LEVEL_2 || "2.0");
    const level3 = parseFloat(process.env.UPSELL_MULTIPLIER_LEVEL_3 || "2.0");
    
    // Level 0 has no multiplier (1.0), then multipliers compound
    return [1.0, level1, level2, level3];
  }

  // Calculate redemption value with upsell multiplier applied
  calculateRedemptionValue(diamonds: number, upsellLevel: number): number {
    const baseInr = this.calculateInrForDiamonds(diamonds);
    const multipliers = this.getUpsellMultipliers();
    
    // Apply cumulative multiplier for upsell level
    // Level 0: 1.0, Level 1: level1, Level 2: level1 * level2, Level 3: level1 * level2 * level3
    let multiplier = 1.0;
    for (let i = 1; i <= upsellLevel && i < multipliers.length; i++) {
      multiplier *= multipliers[i];
    }
    
    return baseInr * multiplier;
  }

  // Redemption Limits
  getMinRedemptionDiamonds(): number {
    return parseInt(process.env.MIN_REDEMPTION_DIAMONDS || "100", 10);
  }

  getMinRedemptionInr(): number {
    return parseFloat(process.env.MIN_REDEMPTION_INR || "10.0");
  }

  // Razorpay Configuration
  getRazorpayKeyId(): string {
    const key = process.env.RAZORPAY_KEY_ID;
    if (!key || key === "undefined") {
      throw new Error("RAZORPAY_KEY_ID environment variable is required");
    }
    return key;
  }

  getRazorpayKeySecret(): string {
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret || secret === "undefined") {
      throw new Error("RAZORPAY_KEY_SECRET environment variable is required");
    }
    return secret;
  }

  getRazorpayWebhookSecret(): string {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret || secret === "undefined") {
      throw new Error("RAZORPAY_WEBHOOK_SECRET environment variable is required");
    }
    return secret;
  }

  // Wallet Service URL
  getWalletServiceUrl(): string {
    return process.env.WALLET_SERVICE_URL || "http://localhost:3005";
  }

  // Transaction timeout for Prisma $transaction (ms)
  getTransactionTimeoutMs(): number {
    return parseInt(process.env.PAYMENT_TRANSACTION_TIMEOUT_MS || "30000", 10);
  }

  // Default limit for purchase/redemption history
  getHistoryDefaultLimit(): number {
    return parseInt(process.env.PAYMENT_HISTORY_DEFAULT_LIMIT || "50", 10);
  }

  // Wallet client: get balance timeout (ms)
  getWalletClientGetBalanceTimeoutMs(): number {
    return parseInt(process.env.WALLET_CLIENT_GET_BALANCE_TIMEOUT_MS || "5000", 10);
  }

  // Wallet client: add/deduct coins timeout (ms)
  getWalletClientRequestTimeoutMs(): number {
    return parseInt(process.env.WALLET_CLIENT_REQUEST_TIMEOUT_MS || "10000", 10);
  }
}
