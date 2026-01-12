import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { GatewayController } from "../routes/gateway.controller.js";
import { RoutingService } from "../services/routing.service.js";
import { AggregationService } from "../services/aggregation.service.js";
import { HealthService } from "../services/health.service.js";
import { RateLimitService } from "../services/rate-limit.service.js";
import { AuthMiddleware } from "../middleware/auth.middleware.js";

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [GatewayController],
  providers: [
    RoutingService,
    AggregationService,
    HealthService,
    RateLimitService,
    AuthMiddleware
  ]
})
export class AppModule {}
