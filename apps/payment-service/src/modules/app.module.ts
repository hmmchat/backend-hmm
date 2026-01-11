import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service.js";
import { PaymentController } from "../routes/payment.controller.js";
import { PaymentService } from "../services/payment.service.js";
import { RazorpayService } from "../services/razorpay.service.js";
import { WalletClientService } from "../services/wallet-client.service.js";
import { PaymentConfigService } from "../config/payment.config.js";
import { EnvValidationService } from "../config/env.validation.js";
import { EncryptionService } from "../services/encryption.service.js";

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [PaymentController],
  providers: [
    PrismaService,
    EnvValidationService,
    EncryptionService,
    PaymentConfigService,
    RazorpayService,
    WalletClientService,
    PaymentService
  ]
})
export class AppModule {}
