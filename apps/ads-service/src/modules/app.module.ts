import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service.js";
import { AdRewardService } from "../services/ad-reward.service.js";
import { WalletClientService } from "../services/wallet-client.service.js";
import { AdRewardConfigService } from "../config/ad-reward.config.js";
import { AdRewardController } from "../routes/ad-reward.controller.js";
import { HealthController } from "../routes/health.controller.js";
import { AdRewardVerificationService } from "../services/ad-reward-verification.service.js";

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [AdRewardController, HealthController],
  providers: [
    PrismaService,
    AdRewardConfigService,
    AdRewardVerificationService,
    WalletClientService,
    AdRewardService
  ]
})
export class AppModule {}
