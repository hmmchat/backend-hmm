import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthController } from "../routes/auth.controller.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AuthService } from "../services/auth.service.js";
import { ProviderGoogle } from "../services/providers/google.provider.js";
import { ProviderApple } from "../services/providers/apple.provider.js";
import { ProviderFacebook } from "../services/providers/facebook.provider.js";
import { ProviderPhone } from "../services/providers/phone.provider.js";
import { MetricService } from "../services/metric.service.js";
import { MetricsController } from "../routes/metrics.controller.js";

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [AuthController, MetricsController],
  providers: [
    PrismaService,
    AuthService,
    ProviderGoogle,
    ProviderApple,
    ProviderFacebook,
    ProviderPhone,
    MetricService
  ]
})
export class AppModule {}
