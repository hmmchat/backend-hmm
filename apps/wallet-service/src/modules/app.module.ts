import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service.js";
import { WalletService } from "../services/wallet.service.js";
import { SeasonService } from "../services/season.service.js";
import { WalletController } from "../routes/wallet.controller.js";
import { SeasonController } from "../routes/season.controller.js";
import { SeasonAdminController } from "../routes/season-admin.controller.js";
import { HealthController } from "../routes/health.controller.js";
import { AdminAuthGuard } from "../guards/admin-auth.guard.js";

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [
    WalletController,
    SeasonController,
    SeasonAdminController,
    HealthController
  ],
  providers: [PrismaService, WalletService, SeasonService, AdminAuthGuard]
})
export class AppModule {}

