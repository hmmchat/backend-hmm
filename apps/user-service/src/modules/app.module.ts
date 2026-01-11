import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service.js";
import { UserController } from "../routes/user.controller.js";
import { UserService } from "../services/user.service.js";
import { ProfileCompletionService } from "../services/profile-completion.service.js";
import { ModerationClientService } from "../services/moderation-client.service.js";
import { MusicService } from "../services/music.service.js";
import { BrandService } from "../services/brand.service.js";

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [UserController],
  providers: [PrismaService, UserService, ProfileCompletionService, ModerationClientService, MusicService, BrandService]
})
export class AppModule {}

