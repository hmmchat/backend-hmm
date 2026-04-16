import { Body, Controller, Param, Post } from "@nestjs/common";
import { z } from "zod";
import { KycService } from "../services/kyc.service.js";

@Controller("v1/kyc")
export class KycController {
  constructor(private readonly kycService: KycService) {}

  @Post("session/start")
  async startSession(@Body() body: unknown) {
    const parsed = z.object({
      userId: z.string().min(1),
      moderatorId: z.string().min(1)
    }).parse(body);
    return this.kycService.startSession(parsed);
  }

  @Post("session/decision")
  async submitDecision(@Body() body: unknown) {
    const parsed = z.object({
      sessionId: z.string().min(1),
      moderatorId: z.string().min(1),
      decision: z.enum(["VERIFIED", "REJECTED", "REVIEW", "REVOKED"]),
      reason: z.string().max(500).optional()
    }).parse(body);
    return this.kycService.submitDecision(parsed);
  }

  @Post("feedback")
  async submitFeedback(@Body() body: unknown) {
    const parsed = z.object({
      userId: z.string().min(1),
      sessionId: z.string().min(1).optional(),
      questionOne: z.string().min(1).max(500),
      questionTwo: z.string().min(1).max(500)
    }).parse(body);
    return this.kycService.submitFeedback(parsed);
  }
}

@Controller("v1/admin/users")
export class KycAdminController {
  constructor(private readonly kycService: KycService) {}

  @Post(":id/kyc/revoke")
  async revokeKyc(@Param("id") id: string, @Body() body: unknown) {
    const parsed = z.object({
      moderatorId: z.string().optional(),
      reason: z.string().max(500).optional()
    }).parse(body ?? {});
    return this.kycService.revokeKyc({
      userId: id,
      moderatorId: parsed.moderatorId,
      reason: parsed.reason
    });
  }
}
