import { Injectable, Logger } from "@nestjs/common";
import * as crypto from "crypto";

/**
 * Service for encrypting/decrypting sensitive data (bank account details)
 * Uses AES-256-GCM encryption
 */
@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly algorithm = "aes-256-gcm";
  private readonly keyLength = 32; // 256 bits
  private readonly ivLength = 16; // 128 bits
  private readonly tagLength = 16; // 128 bits
  private readonly saltLength = 64;

  /**
   * Get encryption key from environment variable or derive from secret
   */
  private getEncryptionKey(): Buffer {
    const encryptionKey = process.env.PAYMENT_ENCRYPTION_KEY;

    if (!encryptionKey) {
      throw new Error(
        "PAYMENT_ENCRYPTION_KEY environment variable is required for encrypting sensitive data"
      );
    }

    // If key is exactly 64 hex characters (32 bytes = 256 bits), use directly
    if (encryptionKey.length === 64 && /^[0-9a-fA-F]+$/.test(encryptionKey)) {
      return Buffer.from(encryptionKey, "hex");
    }

    // Otherwise, derive a 256-bit key using PBKDF2
    return crypto.pbkdf2Sync(
      encryptionKey,
      "payment-service-salt", // Fixed salt for key derivation
      100000, // Iterations
      this.keyLength,
      "sha256"
    );
  }

  /**
   * Encrypt sensitive data
   * Returns base64-encoded string: IV + AuthTag + EncryptedData
   */
  encrypt(plaintext: string): string {
    if (!plaintext) {
      return plaintext;
    }

    try {
      const key = this.getEncryptionKey();
      const iv = crypto.randomBytes(this.ivLength);
      const cipher = crypto.createCipheriv(this.algorithm, key, iv);

      let encrypted = cipher.update(plaintext, "utf8");
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      const authTag = cipher.getAuthTag();

      // Combine IV + AuthTag + EncryptedData
      const combined = Buffer.concat([iv, authTag, encrypted]);

      // Return as base64 for easy storage
      return combined.toString("base64");
    } catch (error: any) {
      this.logger.error(`Encryption failed: ${error.message}`);
      throw new Error(`Failed to encrypt data: ${error.message}`);
    }
  }

  /**
   * Decrypt sensitive data
   * Expects base64-encoded string: IV + AuthTag + EncryptedData
   */
  decrypt(encryptedData: string): string {
    if (!encryptedData) {
      return encryptedData;
    }

    try {
      const key = this.getEncryptionKey();
      const combined = Buffer.from(encryptedData, "base64");

      // Extract IV, AuthTag, and EncryptedData
      const iv = combined.subarray(0, this.ivLength);
      const authTag = combined.subarray(this.ivLength, this.ivLength + this.tagLength);
      const encrypted = combined.subarray(this.ivLength + this.tagLength);

      const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encrypted);
      decrypted = Buffer.concat([decrypted, decipher.final()]);

      return decrypted.toString("utf8");
    } catch (error: any) {
      this.logger.error(`Decryption failed: ${error.message}`);
      throw new Error(`Failed to decrypt data: ${error.message}`);
    }
  }

  /**
   * Hash sensitive data (one-way, for search/comparison)
   * Uses SHA-256 with salt
   */
  hash(plaintext: string, salt?: string): { hash: string; salt: string } {
    const usedSalt = salt || crypto.randomBytes(this.saltLength).toString("hex");
    const hash = crypto
      .pbkdf2Sync(plaintext, usedSalt, 100000, this.keyLength, "sha256")
      .toString("hex");

    return { hash, salt: usedSalt };
  }

  /**
   * Verify hash
   */
  verifyHash(plaintext: string, hash: string, salt: string): boolean {
    const computed = this.hash(plaintext, salt);
    return computed.hash === hash;
  }
}
