import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { HomepageController } from "../routes/homepage.controller.js";
import { MetricsController } from "../routes/metrics.controller.js";
import { GenderFilterController } from "../routes/gender-filter.controller.js";
import { LocationController } from "../routes/location.controller.js";
import { DiscoveryController } from "../routes/discovery.controller.js";
import { SquadController } from "../routes/squad.controller.js";
import { HealthController } from "../routes/health.controller.js";
import { MetricService } from "../services/metric.service.js";
import { UserClientService } from "../services/user-client.service.js";
import { WalletClientService } from "../services/wallet-client.service.js";
import { GenderFilterService } from "../services/gender-filter.service.js";
import { LocationService } from "../services/location.service.js";
import { DiscoveryService } from "../services/discovery.service.js";
import { MatchingService } from "../services/matching.service.js";
import { SquadService } from "../services/squad.service.js";
import { NotificationService } from "../services/notification.service.js";
import { NotificationGateway } from "../gateways/notification.gateway.js";
import { FriendClientService } from "../services/friend-client.service.js";
import { StreamingClientService } from "../services/streaming-client.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { CacheService } from "../services/cache.service.js";

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [
    HomepageController,
    MetricsController,
    GenderFilterController,
    LocationController,
    DiscoveryController,
    SquadController,
    HealthController
  ],
  providers: [
    MetricService,
    UserClientService,
    WalletClientService,
    GenderFilterService,
    LocationService,
    DiscoveryService,
    MatchingService,
    SquadService,
    NotificationService,
    NotificationGateway,
    FriendClientService,
    StreamingClientService,
    PrismaService,
    CacheService
  ]
})
export class AppModule {}

