import { createHmac, randomInt, timingSafeEqual } from "crypto";
import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { RedisService } from "../redis.service.js";

type StoredOtp = {
  hash: string;
  attempts: number;
};

@Injectable()
export class ProviderPhone {
  private readonly logger = new Logger(ProviderPhone.name);

  private readonly otpLength: number;
  private readonly otpTtlSeconds: number;
  private readonly resendCooldownSeconds: number;
  private readonly maxSendsPerDay: number;
  private readonly maxVerifyAttempts: number;
  private readonly authKey: string;
  private readonly templateId: string;
  private readonly pepper: string;

  constructor(private readonly redis: RedisService) {
    this.otpLength = clampInt(process.env.OTP_LENGTH, 6, 4, 8);
    this.otpTtlSeconds = clampInt(process.env.OTP_TTL_SECONDS, 300, 60, 900);
    this.resendCooldownSeconds = clampInt(
      process.env.OTP_RESEND_COOLDOWN_SECONDS,
      45,
      15,
      300
    );
    this.maxSendsPerDay = clampInt(process.env.OTP_MAX_SENDS_PER_DAY, 10, 1, 50);
    this.maxVerifyAttempts = clampInt(process.env.OTP_MAX_VERIFY_ATTEMPTS, 5, 3, 10);
    this.authKey = (process.env.MSG91_AUTH_KEY || "").trim();
    this.templateId = (process.env.MSG91_TEMPLATE_ID || "").trim();
    this.pepper =
      (process.env.OTP_PEPPER || "").trim() ||
      this.authKey ||
      "beam-otp-dev-pepper";
  }

  async send(phone: string) {
    this.assertConfigured();
    this.assertRedis();

    const mobile = toMsg91Mobile(phone);
    await this.assertCanSend(phone);

    const code = this.generateOtp();
    await this.sendViaMsg91(mobile, code);

    const payload: StoredOtp = {
      hash: this.hashOtp(phone, code),
      attempts: 0
    };
    await this.redis.set(
      this.otpKey(phone),
      JSON.stringify(payload),
      this.otpTtlSeconds
    );
    await this.redis.set(
      this.cooldownKey(phone),
      "1",
      this.resendCooldownSeconds
    );
    await this.bumpDailySendCount(phone);

    return { ok: true };
  }

  async verify(phone: string, code: string) {
    this.assertRedis();

    const raw = await this.redis.get(this.otpKey(phone));
    if (!raw) {
      throw new HttpException("Invalid or expired OTP", HttpStatus.UNAUTHORIZED);
    }

    let stored: StoredOtp;
    try {
      stored = JSON.parse(raw) as StoredOtp;
    } catch {
      await this.redis.del(this.otpKey(phone));
      throw new HttpException("Invalid or expired OTP", HttpStatus.UNAUTHORIZED);
    }

    if (stored.attempts >= this.maxVerifyAttempts) {
      await this.redis.del(this.otpKey(phone));
      throw new HttpException(
        "Too many invalid OTP attempts. Request a new code.",
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    const expected = Buffer.from(stored.hash, "hex");
    const actual = Buffer.from(this.hashOtp(phone, code.trim()), "hex");
    const matches =
      expected.length === actual.length && timingSafeEqual(expected, actual);

    if (!matches) {
      stored.attempts += 1;
      const ttl = await this.redis.ttl(this.otpKey(phone));
      const remainingTtl = ttl > 0 ? ttl : this.otpTtlSeconds;
      if (stored.attempts >= this.maxVerifyAttempts) {
        await this.redis.del(this.otpKey(phone));
        throw new HttpException(
          "Too many invalid OTP attempts. Request a new code.",
          HttpStatus.TOO_MANY_REQUESTS
        );
      }
      await this.redis.set(this.otpKey(phone), JSON.stringify(stored), remainingTtl);
      throw new HttpException("Invalid or expired OTP", HttpStatus.UNAUTHORIZED);
    }

    await this.redis.del(this.otpKey(phone));
    await this.redis.del(this.cooldownKey(phone));
    return { ok: true };
  }

  private assertConfigured() {
    if (!this.authKey || !this.templateId) {
      throw new HttpException(
        "MSG91 is not configured (MSG91_AUTH_KEY / MSG91_TEMPLATE_ID)",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  private assertRedis() {
    if (!this.redis.isAvailable()) {
      throw new HttpException(
        "OTP service temporarily unavailable",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  private async assertCanSend(phone: string) {
    const cooldownTtl = await this.redis.ttl(this.cooldownKey(phone));
    if (cooldownTtl > 0) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `Please wait ${cooldownTtl}s before requesting another OTP`,
          retryAfter: cooldownTtl
        },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    const dailyRaw = await this.redis.get(this.dailyKey(phone));
    const dailyCount = dailyRaw ? parseInt(dailyRaw, 10) : 0;
    if (dailyCount >= this.maxSendsPerDay) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `Daily OTP limit reached (${this.maxSendsPerDay}). Try again tomorrow.`,
          retryAfter: 3600
        },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
  }

  private async bumpDailySendCount(phone: string) {
    const key = this.dailyKey(phone);
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, secondsUntilEndOfUtcDay());
    }
  }

  private generateOtp(): string {
    const min = 10 ** (this.otpLength - 1);
    const max = 10 ** this.otpLength;
    return String(randomInt(min, max));
  }

  private hashOtp(phone: string, code: string): string {
    return createHmac("sha256", this.pepper)
      .update(`${phone}:${code}`)
      .digest("hex");
  }

  private async sendViaMsg91(mobile: string, otp: string) {
    const payload: Record<string, unknown> = {
      template_id: this.templateId,
      short_url: "0",
      realTimeResponse: "1",
      recipients: [
        {
          mobiles: mobile,
          OTP: otp
        }
      ]
    };

    const senderId = (process.env.MSG91_SENDER_ID || "").trim();
    if (senderId) {
      payload.sender = senderId;
    }

    let response: Response;
    try {
      response = await fetch("https://control.msg91.com/api/v5/flow", {
        method: "POST",
        headers: {
          authkey: this.authKey,
          accept: "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      this.logger.error(`MSG91 network error: ${(err as Error).message}`);
      throw new HttpException(
        "Failed to send SMS OTP",
        HttpStatus.BAD_GATEWAY
      );
    }

    const bodyText = await response.text();
    let body: { type?: string; message?: string } = {};
    try {
      body = bodyText ? (JSON.parse(bodyText) as typeof body) : {};
    } catch {
      body = { message: bodyText };
    }

    const type = (body.type || "").toLowerCase();
    const failed = !response.ok || (type !== "" && type !== "success");
    if (failed) {
      this.logger.error(
        `MSG91 flow send failed status=${response.status} body=${bodyText.slice(0, 300)}`
      );
      throw new HttpException(
        "Failed to send SMS OTP",
        HttpStatus.BAD_GATEWAY
      );
    }
  }

  private otpKey(phone: string) {
    return `auth:otp:${phone}`;
  }

  private cooldownKey(phone: string) {
    return `auth:otp:cooldown:${phone}`;
  }

  private dailyKey(phone: string) {
    const day = new Date().toISOString().slice(0, 10);
    return `auth:otp:daily:${phone}:${day}`;
  }
}

function toMsg91Mobile(phone: string): string {
  // Controller validates +91XXXXXXXXXX
  return phone.replace(/^\+/, "");
}

function clampInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const n = parseInt(raw || "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function secondsUntilEndOfUtcDay(): number {
  const now = new Date();
  const end = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0
  );
  return Math.max(60, Math.floor((end - now.getTime()) / 1000));
}
