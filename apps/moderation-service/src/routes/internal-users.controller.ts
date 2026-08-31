import {
  Controller,
  Delete,
  Headers,
  HttpException,
  HttpStatus,
  HttpCode,
  Param,
  Query
} from "@nestjs/common";
import { DareSubmissionService } from "../services/dare-submission.service.js";
import { KycService } from "../services/kyc.service.js";

@Controller("internal/users")
export class InternalUsersController {
  constructor(
    private readonly dareSubmissionService: DareSubmissionService,
    private readonly kycService: KycService
  ) {}

  private assertInternal(internalToken?: string, serviceToken?: string): void {
    const expected = process.env.INTERNAL_SERVICE_TOKEN;
    if (!expected) {
      throw new HttpException(
        "INTERNAL_SERVICE_TOKEN is not configured",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
    const provided = internalToken || serviceToken;
    if (!provided || provided !== expected) {
      throw new HttpException("Unauthorized internal request", HttpStatus.UNAUTHORIZED);
    }
  }

  @Delete(":userId")
  @HttpCode(HttpStatus.OK)
  async purgeUser(
    @Param("userId") userId: string,
    @Query("mode") mode: string | undefined,
    @Headers("x-internal-token") internalToken?: string,
    @Headers("x-service-token") serviceToken?: string
  ) {
    this.assertInternal(internalToken, serviceToken);
    const purgeMode = mode === "hard" ? "hard" : "self";
    await this.dareSubmissionService.purgeUser(userId);
    await this.kycService.purgeUser(userId, purgeMode);
    return { ok: true, mode: purgeMode };
  }
}
