import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./modules/app.module.js";
import { ConfigService } from "@nestjs/config";
import { ZodExceptionFilter } from "./filters/zod-exception.filter.js";
import { NotificationGateway } from "./gateways/notification.gateway.js";
import { SquadService } from "./services/squad.service.js";
import { WebSocketServer } from "ws";

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ 
      logger: true,
      requestTimeout: 8000  // 8 second request timeout (less than gateway's 10s)
    })
  );

  const config = app.get(ConfigService);
  const port = config.get<number>("PORT") || 3004;

  const origins = (process.env.ALLOWED_ORIGINS ?? "").split(",").filter(Boolean);
  app.enableCors({
    origin: origins.length ? origins : true,
    credentials: true
  });

  // Register global exception filter for Zod validation errors
  app.useGlobalFilters(new ZodExceptionFilter());

  await app.listen(port, "0.0.0.0");
  
  // Setup WebSocket server for notifications (after app is listening)
  const fastifyInstance = app.getHttpAdapter().getInstance();
  const server = (fastifyInstance as any).server;
  
  // Create WebSocket server for notifications
  const wss = new WebSocketServer({ 
    server,
    path: "/notifications/ws"
  });

  // Initialize WebSocket gateway
  const notificationGateway = app.get(NotificationGateway);
  notificationGateway.initialize(wss);

  // Initialize cleanup jobs for squad invitations
  const squadService = app.get(SquadService);
  const cleanupIntervalMs = parseInt(process.env.SQUAD_CLEANUP_INTERVAL_MS || "60000", 10); // Default 1 minute
  
  setInterval(async () => {
    try {
      await squadService.cleanupExpiredInvitations();
    } catch (error) {
      console.error("[ERROR] Failed to cleanup expired squad invitations:", error);
    }
  }, cleanupIntervalMs);

  console.log(`🚀 Discovery service running on http://localhost:${port}`);
  console.log(`📡 Notification WebSocket server running on ws://localhost:${port}/notifications/ws`);
  console.log(`🧹 Squad invitation cleanup job initialized (every ${cleanupIntervalMs}ms)`);
}

// Global error handlers
process.on('uncaughtException', (error: Error) => {
  console.error('Uncaught Exception:', error);
  // Don't exit - log and continue
});

process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit - log and continue
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  process.exit(0);
});

bootstrap();
