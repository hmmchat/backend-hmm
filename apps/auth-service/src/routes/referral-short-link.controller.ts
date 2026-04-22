import { Controller, Get, Param, Redirect } from "@nestjs/common";
import { z } from "zod";
import { AuthService } from "../services/auth.service.js";

const referralCodeSchema = z
  .string()
  .trim()
  .min(4)
  .max(80)
  .regex(/^[A-Za-z0-9]+$/, "Invalid referral code format");

@Controller()
export class ReferralShortLinkController {
  constructor(private readonly auth: AuthService) {}

  @Get("r/:referralCode")
  @Redirect(undefined, 302)
  redirectReferral(@Param("referralCode") referralCodeRaw: string) {
    const referralCode = referralCodeSchema.parse(referralCodeRaw);
    return { url: this.auth.getReferralShareRedirectTarget(referralCode) };
  }
}
