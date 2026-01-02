import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { HomepageController } from "../routes/homepage.controller.js";
import { MetricsController } from "../routes/metrics.controller.js";
import { MetricService } from "../services/metric.service.js";
import { UserClientService } from "../services/user-client.service.js";
// WalletClientService will be added when we implement homepage aggregation

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [HomepageController, MetricsController],
  providers: [MetricService, UserClientService]
})
export class AppModule {}

