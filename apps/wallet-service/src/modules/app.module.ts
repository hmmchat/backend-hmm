import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service.js";
import { WalletService } from "../services/wallet.service.js";
import { WalletController } from "../routes/wallet.controller.js";
import { HealthController } from "../routes/health.controller.js";

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [WalletController, HealthController],
  providers: [PrismaService, WalletService]
})
export class AppModule {}

