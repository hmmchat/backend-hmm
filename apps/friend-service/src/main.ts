import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./modules/app.module.js";
import { ConfigService } from "@nestjs/config";
import { ZodExceptionFilter } from "./filters/zod-exception.filter.js";
import { WebSocketServer } from "ws";
import { MessagingGateway } from "./gateways/messaging.gateway.js";

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ 
      logger: true,
      requestTimeout: 30000  // 30 second request timeout (for image generation)
    })
  );

  const config = app.get(ConfigService);
  const port = config.get<number>("PORT") || 3009;

  const origins = (process.env.ALLOWED_ORIGINS ?? "").split(",").filter(Boolean);
  app.enableCors({
    origin: origins.length ? origins : true,
    credentials: true
  });

  // Register global exception filter for Zod validation errors
  app.useGlobalFilters(new ZodExceptionFilter());

  await app.listen(port, "0.0.0.0");

  // Setup WebSocket server using ws package directly (same pattern as streaming-service)
  const fastifyInstance = app.getHttpAdapter().getInstance();
  const server = (fastifyInstance as any).server;
  const wss = new WebSocketServer({
    server,
    path: "/friends/ws"
  });
  const gateway = app.get(MessagingGateway);
  gateway.initialize(wss);

  console.log(`🚀 Friend service running on http://localhost:${port}`);
  console.log(`📡 WebSocket server running on ws://localhost:${port}/friends/ws`);
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
