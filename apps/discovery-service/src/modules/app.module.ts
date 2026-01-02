import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { HomepageController } from "../routes/homepage.controller.js";
import { MetricsController } from "../routes/metrics.controller.js";
import { GenderFilterController } from "../routes/gender-filter.controller.js";
import { MetricService } from "../services/metric.service.js";
import { UserClientService } from "../services/user-client.service.js";
import { WalletClientService } from "../services/wallet-client.service.js";
import { GenderFilterService } from "../services/gender-filter.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [HomepageController, MetricsController, GenderFilterController],
  providers: [
    MetricService,
    UserClientService,
    WalletClientService,
    GenderFilterService,
    PrismaService
  ]
})
export class AppModule {}

