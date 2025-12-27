import { Injectable } from "@nestjs/common";
import twilio from "twilio";

@Injectable()
export class ProviderPhone {
  private client: any;

  constructor() {
    this.client = twilio(
      process.env.TWILIO_ACCOUNT_SID!,
      process.env.TWILIO_AUTH_TOKEN!
    );
  }

  async send(phone: string) {
    try {
      // Phone already includes +91 prefix from validation
      await this.client.verify.v2.services(process.env.TWILIO_VERIFY_SID!)
        .verifications.create({ to: phone, channel: "sms" });
      return { ok: true };
    } catch (err) {
      throw new Error("Failed to send SMS OTP: " + (err as Error).message);
    }
  }

  async verify(phone: string, code: string) {
    try {
      // Phone already includes +91 prefix from validation
      const result = await this.client.verify.v2.services(process.env.TWILIO_VERIFY_SID!)
        .verificationChecks.create({ to: phone, code });
      if (result.status !== "approved") throw new Error("Invalid or expired OTP");
      return { ok: true };
    } catch (err) {
      throw new Error("OTP verification failed: " + (err as Error).message);
    }
  }
}