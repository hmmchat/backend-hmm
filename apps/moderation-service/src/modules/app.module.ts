import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ModerationController } from "../routes/moderation.controller.js";
import { DareSubmissionController } from "../routes/dare-submission.controller.js";
import { KycAdminController, KycController } from "../routes/kyc.controller.js";
import { HealthController } from "../routes/health.controller.js";
import { ModerationService } from "../services/moderation.service.js";
import { DareSubmissionService } from "../services/dare-submission.service.js";
import { KycService } from "../services/kyc.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [ModerationController, DareSubmissionController, KycController, KycAdminController, HealthController],
  providers: [PrismaService, ModerationService, DareSubmissionService, KycService],
  exports: [ModerationService, DareSubmissionService, KycService]
})
export class AppModule {}

