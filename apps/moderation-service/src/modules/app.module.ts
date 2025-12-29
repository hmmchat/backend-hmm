import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ModerationController } from "../routes/moderation.controller.js";
import { ModerationService } from "../services/moderation.service.js";

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [ModerationController],
  providers: [ModerationService],
  exports: [ModerationService]
})
export class AppModule {}

