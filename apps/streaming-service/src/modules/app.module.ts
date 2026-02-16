import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { StreamingController } from "../controllers/streaming.controller.js";
import { DareController } from "../controllers/dare.controller.js";
import { GiftController } from "../controllers/gift.controller.js";
import { IcebreakerAdminController } from "../controllers/icebreaker-admin.controller.js";
import { DareAdminController } from "../controllers/dare-admin.controller.js";
import { LoadingMemeController } from "../controllers/loading-meme.controller.js";
import { LoadingMemeAdminController } from "../controllers/loading-meme-admin.controller.js";
import { HealthController } from "../controllers/health.controller.js";
import { StreamingGateway } from "../gateways/streaming.gateway.js";
import { MediasoupService } from "../services/mediasoup.service.js";
import { RoomService } from "../services/room.service.js";
import { CallService } from "../services/call.service.js";
import { BroadcastService } from "../services/broadcast.service.js";
import { ChatService } from "../services/chat.service.js";
import { DareService } from "../services/dare.service.js";
import { GiftService } from "../services/gift.service.js";
import { IcebreakerService } from "../services/icebreaker.service.js";
import { LoadingMemeService } from "../services/loading-meme.service.js";
import { WalletClientService } from "../services/wallet-client.service.js";
import { DiscoveryClientService } from "../services/discovery-client.service.js";
import { FriendClientService } from "../services/friend-client.service.js";
import { HistoryService } from "../services/history.service.js";
import { FavouriteService } from "../services/favourite.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [
    StreamingController,
    DareController,
    GiftController,
    IcebreakerAdminController,
    DareAdminController,
    LoadingMemeController,
    LoadingMemeAdminController,
    HealthController
  ],
  providers: [
    PrismaService,
    MediasoupService,
    RoomService,
    CallService,
    BroadcastService,
    ChatService,
    DareService,
    GiftService,
    IcebreakerService,
    LoadingMemeService,
    WalletClientService,
    DiscoveryClientService,
    FriendClientService,
    HistoryService,
    FavouriteService,
    StreamingGateway
  ]
})
export class AppModule {}
