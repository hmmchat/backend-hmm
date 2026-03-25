import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service.js";
import { FriendService } from "../services/friend.service.js";
import { WalletClientService } from "../services/wallet-client.service.js";
import { RedisService } from "../services/redis.service.js";
import { MetricsService } from "../services/metrics.service.js";
import { ConversationService } from "../services/conversation.service.js";
import { GiftCatalogService } from "../services/gift-catalog.service.js";
import { UserClientService } from "../services/user-client.service.js";
import { StreamingClientService } from "../services/streaming-client.service.js";
import { FilesClientService } from "../services/files-client.service.js";
import { FriendsWallImageService } from "../services/friends-wall-image.service.js";
import { RateLimitGuard } from "../guards/rate-limit.guard.js";
import { ConversationRateLimitGuard } from "../guards/conversation-rate-limit.guard.js";
import { NotificationRateLimitGuard } from "../guards/notification-rate-limit.guard.js";
import { ShareRateLimitGuard } from "../guards/share-rate-limit.guard.js";
import { FriendController } from "../routes/friend.controller.js";
import { HealthController } from "../routes/health.controller.js";
import { GiftAdminController } from "../routes/gift-admin.controller.js";
import { CleanupTasksService } from "../services/cleanup-tasks.service.js";
import { MessagingGateway } from "../gateways/messaging.gateway.js";
import { MessagingRealtimeService } from "../services/messaging-realtime.service.js";
import { WsAuthService } from "../services/ws-auth.service.js";

@Module({
  imports: [
    ConfigModule.forRoot(),
    ScheduleModule.forRoot() // Enable cron jobs
  ],
  controllers: [FriendController, HealthController, GiftAdminController],
  providers: [
    PrismaService,
    FriendService,
    WalletClientService,
    RedisService,
    MetricsService,
    ConversationService,
    GiftCatalogService,
    UserClientService,
    StreamingClientService,
    FilesClientService,
    FriendsWallImageService,
    RateLimitGuard,
    ConversationRateLimitGuard,
    NotificationRateLimitGuard,
    ShareRateLimitGuard,
    CleanupTasksService,
    MessagingGateway,
    MessagingRealtimeService,
    WsAuthService
  ]
})
export class AppModule {}
