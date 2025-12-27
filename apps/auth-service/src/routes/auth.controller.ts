import { Body, Controller, HttpException, HttpStatus, Post } from "@nestjs/common";
import { z } from "zod";
import { AuthService } from "../services/auth.service.js";

const termsSchema = z.object({
  acceptedTerms: z.boolean().refine(v => v, "You must accept Terms & Conditions."),
  acceptedTermsVer: z.string().default("v1.0")
});

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("google")
  async google(@Body() body: any) {
    const schema = z.object({
      idToken: z.string().min(10)
    }).and(termsSchema);
    const dto = schema.parse(body);
    return this.auth.loginWithGoogle(dto.idToken, dto.acceptedTermsVer);
  }

  @Post("apple")
  async apple(@Body() body: any) {
    const schema = z.object({
      identityToken: z.string().min(10)
    }).and(termsSchema);
    const dto = schema.parse(body);
    return this.auth.loginWithApple(dto.identityToken, dto.acceptedTermsVer);
  }

  @Post("facebook")
  async facebook(@Body() body: any) {
    const schema = z.object({
      accessToken: z.string().min(10)
    }).and(termsSchema);
    const dto = schema.parse(body);
    return this.auth.loginWithFacebook(dto.accessToken, dto.acceptedTermsVer);
  }

  @Post("phone/send-otp")
  async sendOtp(@Body() body: any) {
    const { phone } = z.object({ phone: z.string().min(8) }).parse(body);
    return this.auth.sendPhoneOtp(phone);
  }

  @Post("phone/verify")
  async verifyOtp(@Body() body: any) {
    const schema = z.object({
      phone: z.string().min(8),
      code: z.string().min(4).max(8)
    }).and(termsSchema);
    const dto = schema.parse(body);
    return this.auth.verifyPhoneOtp(dto.phone, dto.code, dto.acceptedTermsVer);
  }

  @Post("refresh")
  async refresh(@Body() body: any) {
    const { refreshToken } = z.object({ refreshToken: z.string().min(20) }).parse(body);
    const result = await this.auth.refresh(refreshToken);
    if (!result) throw new HttpException("Invalid refresh token", HttpStatus.UNAUTHORIZED);
    return result;
  }

  @Post("logout")
  async logout(@Body() body: any) {
    const { refreshToken } = z.object({ refreshToken: z.string().min(20) }).parse(body);
    await this.auth.logout(refreshToken);
    return { ok: true };
  }
}