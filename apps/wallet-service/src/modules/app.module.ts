import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service.js";
import { WalletService } from "../services/wallet.service.js";
import { WalletController } from "../routes/wallet.controller.js";

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [WalletController],
  providers: [PrismaService, WalletService]
})
export class AppModule {}

