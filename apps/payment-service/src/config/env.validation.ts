import { Injectable, OnModuleInit } from "@nestjs/common";

/**
 * Validates all required environment variables at application startup
 * Throws error if any required variable is missing
 */
@Injectable()
export class EnvValidationService implements OnModuleInit {
  async onModuleInit() {
    this.validateEnvironmentVariables();
  }

  private validateEnvironmentVariables(): void {
    const errors: string[] = [];
    const isTestMode = process.env.NODE_ENV === "test" || process.env.ALLOW_TEST_MODE === "true";

    // Razorpay Configuration (Required for production, optional for test mode)
    if (!isTestMode) {
      if (!process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID === "undefined") {
        errors.push("RAZORPAY_KEY_ID is required");
      }

      if (!process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET === "undefined") {
        errors.push("RAZORPAY_KEY_SECRET is required");
      }

      if (!process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_WEBHOOK_SECRET === "undefined") {
        errors.push("RAZORPAY_WEBHOOK_SECRET is required");
      }
    } else {
      console.warn("⚠️  Running in TEST MODE - Razorpay keys are optional (test endpoints only)");
    }

    // Database (Required for production, optional for test mode - test endpoints don't need DB)
    if (!isTestMode) {
      if (!process.env.DATABASE_URL || process.env.DATABASE_URL === "undefined") {
        errors.push("DATABASE_URL is required");
      }
    } else {
      if (!process.env.DATABASE_URL || process.env.DATABASE_URL === "undefined") {
        console.warn("⚠️  DATABASE_URL not set - test endpoints will work, but DB operations will fail");
      }
    }

    // JWT (Required for authenticated endpoints, optional for test mode)
    if (!isTestMode) {
      if (!process.env.JWT_PUBLIC_JWK || process.env.JWT_PUBLIC_JWK === "undefined") {
        errors.push("JWT_PUBLIC_JWK is required");
      }
    } else {
      if (!process.env.JWT_PUBLIC_JWK || process.env.JWT_PUBLIC_JWK === "undefined") {
        console.warn("⚠️  JWT_PUBLIC_JWK not set - test endpoints will work, but authenticated endpoints will fail");
      }
    }

    // Wallet Service URL (Required)
    if (!process.env.WALLET_SERVICE_URL) {
      // Use default but warn
      console.warn("WARNING: WALLET_SERVICE_URL not set, using default: http://localhost:3005");
    }

    // Optional but recommended
    if (!process.env.RAZORPAY_ACCOUNT_NUMBER) {
      console.warn("WARNING: RAZORPAY_ACCOUNT_NUMBER not set. Payouts will fail without this.");
    }

    // Encryption key (Required for production, optional for test mode)
    if (!isTestMode) {
      if (!process.env.PAYMENT_ENCRYPTION_KEY) {
        errors.push("PAYMENT_ENCRYPTION_KEY is required for encrypting sensitive bank account data");
      } else if (process.env.PAYMENT_ENCRYPTION_KEY.length < 32) {
        errors.push("PAYMENT_ENCRYPTION_KEY must be at least 32 characters long (recommended: 64 hex characters)");
      }
    } else {
      // In test mode, use a default test key if not provided
      if (!process.env.PAYMENT_ENCRYPTION_KEY) {
        process.env.PAYMENT_ENCRYPTION_KEY = "test-encryption-key-32-chars-long-for-testing-only-do-not-use-in-production";
        console.warn("⚠️  Using default test encryption key - NOT SECURE FOR PRODUCTION");
      }
    }

    // Validate numeric values
    const inrPerCoin = parseFloat(process.env.INR_PER_COIN || "0.01");
    if (isNaN(inrPerCoin) || inrPerCoin <= 0) {
      errors.push("INR_PER_COIN must be a positive number");
    }

    const diamondToCoinRate = parseInt(process.env.DIAMOND_TO_COIN_RATE || "50", 10);
    if (isNaN(diamondToCoinRate) || diamondToCoinRate <= 0) {
      errors.push("DIAMOND_TO_COIN_RATE must be a positive integer");
    }

    const diamondToInrRate = parseFloat(process.env.DIAMOND_TO_INR_RATE || "0.4");
    if (isNaN(diamondToInrRate) || diamondToInrRate <= 0) {
      errors.push("DIAMOND_TO_INR_RATE must be a positive number");
    }

    // Validate upsell multipliers
    for (let i = 1; i <= 3; i++) {
      const multiplier = parseFloat(
        process.env[`UPSELL_MULTIPLIER_LEVEL_${i}`] || (i === 1 ? "2.0" : "2.0")
      );
      if (isNaN(multiplier) || multiplier <= 0) {
        errors.push(`UPSELL_MULTIPLIER_LEVEL_${i} must be a positive number`);
      }
    }

    // Validate minimum redemption amounts
    const minDiamonds = parseInt(process.env.MIN_REDEMPTION_DIAMONDS || "100", 10);
    if (isNaN(minDiamonds) || minDiamonds <= 0) {
      errors.push("MIN_REDEMPTION_DIAMONDS must be a positive integer");
    }

    const minInr = parseFloat(process.env.MIN_REDEMPTION_INR || "10.0");
    if (isNaN(minInr) || minInr <= 0) {
      errors.push("MIN_REDEMPTION_INR must be a positive number");
    }

    // Throw if any errors found (unless in test mode)
    if (errors.length > 0) {
      const errorMessage = `Payment Service Configuration Errors:\n${errors.map(e => `  - ${e}`).join("\n")}`;
      
      if (isTestMode) {
        console.warn(`⚠️  Configuration warnings in TEST MODE:\n${errors.map(e => `  - ${e}`).join("\n")}`);
        console.warn("⚠️  Service will start, but some features may not work without proper configuration");
      } else {
        throw new Error(errorMessage);
      }
    } else {
      console.log("✅ All required environment variables validated successfully");
    }
  }
}
