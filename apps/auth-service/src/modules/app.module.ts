import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthController } from "../routes/auth.controller.js";
import { HealthController } from "../routes/health.controller.js";
import { ReferralsController } from "../routes/referrals.controller.js";
import { ReferralShortLinkController } from "../routes/referral-short-link.controller.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AuthService } from "../services/auth.service.js";
import { ProviderGoogle } from "../services/providers/google.provider.js";
import { ProviderApple } from "../services/providers/apple.provider.js";
import { ProviderFacebook } from "../services/providers/facebook.provider.js";
import { ProviderPhone } from "../services/providers/phone.provider.js";

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [
    AuthController,
    ReferralsController,
    ReferralShortLinkController,
    HealthController
  ],
  providers: [
    PrismaService,
    AuthService,
    ProviderGoogle,
    ProviderApple,
    ProviderFacebook,
    ProviderPhone
  ]
})
export class AppModule {}
