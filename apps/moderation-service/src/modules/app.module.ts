import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ModerationController } from "../routes/moderation.controller.js";
import { DareSubmissionController } from "../routes/dare-submission.controller.js";
import { HealthController } from "../routes/health.controller.js";
import { ModerationService } from "../services/moderation.service.js";
import { DareSubmissionService } from "../services/dare-submission.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [ModerationController, DareSubmissionController, HealthController],
  providers: [PrismaService, ModerationService, DareSubmissionService],
  exports: [ModerationService, DareSubmissionService]
})
export class AppModule {}

