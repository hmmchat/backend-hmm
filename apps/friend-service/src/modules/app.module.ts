import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service.js";
import { FriendService } from "../services/friend.service.js";
import { WalletClientService } from "../services/wallet-client.service.js";
import { RedisService } from "../services/redis.service.js";
import { MetricsService } from "../services/metrics.service.js";
import { FriendController } from "../routes/friend.controller.js";
import { CleanupTasksService } from "../services/cleanup-tasks.service.js";

@Module({
  imports: [
    ConfigModule.forRoot(),
    ScheduleModule.forRoot() // Enable cron jobs
  ],
  controllers: [FriendController],
  providers: [
    PrismaService,
    FriendService,
    WalletClientService,
    RedisService,
    MetricsService,
    CleanupTasksService
  ]
})
export class AppModule {}
