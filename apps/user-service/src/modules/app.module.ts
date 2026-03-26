import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service.js";
import { UserController } from "../routes/user.controller.js";
import { CatalogAdminController } from "../routes/catalog-admin.controller.js";
import { BrandAdminController } from "../routes/brand-admin.controller.js";
import { UsersAdminController } from "../routes/users-admin.controller.js";
import { ZodiacAdminController } from "../routes/zodiac-admin.controller.js";
import { BadgeController } from "../routes/badge.controller.js";
import { HealthController } from "../routes/health.controller.js";
import { UserService } from "../services/user.service.js";
import { ProfileCompletionService } from "../services/profile-completion.service.js";
import { ModerationClientService } from "../services/moderation-client.service.js";
import { MusicService } from "../services/music.service.js";
import { BrandService } from "../services/brand.service.js";
import { BadgeService } from "../services/badge.service.js";
import { WalletClientService } from "../services/wallet-client.service.js";
import { AuthClientService } from "../services/auth-client.service.js";

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [
    UserController,
    BadgeController,
    HealthController,
    CatalogAdminController,
    BrandAdminController,
    ZodiacAdminController,
    UsersAdminController
  ],
  providers: [PrismaService, UserService, ProfileCompletionService, ModerationClientService, MusicService, BrandService, BadgeService, WalletClientService, AuthClientService]
})
export class AppModule {}

