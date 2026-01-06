import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./modules/app.module.js";
import { ConfigService } from "@nestjs/config";
import { ZodExceptionFilter, BadRequestExceptionFilter } from "./filters/zod-exception.filter.js";
import { StreamingGateway } from "./gateways/streaming.gateway.js";
import { WebSocketServer } from "ws";

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true })
  );

  const config = app.get(ConfigService);
  const port = config.get<number>("PORT") || 3005;

  const origins = (process.env.ALLOWED_ORIGINS ?? "").split(",").filter(Boolean);
  // In TEST_MODE or if no origins specified, allow all origins (especially for local testing)
  const testMode = process.env.TEST_MODE === "true";
  const allowedOrigins = testMode || origins.length === 0 ? true : origins;
  
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
  });

  // Register global exception filters
  // Note: Order matters - more specific filters should come first
  app.useGlobalFilters(new BadRequestExceptionFilter(), new ZodExceptionFilter());

  await app.listen(port, "0.0.0.0");
  
  // Setup WebSocket server using ws package directly (after app is listening)
  const fastifyInstance = app.getHttpAdapter().getInstance();
  const server = (fastifyInstance as any).server;
  
  // Create WebSocket server - path is handled by ws package
  const wss = new WebSocketServer({ 
    server,
    path: "/streaming/ws"
  });

  // Initialize WebSocket gateway with ws server
  const gateway = app.get(StreamingGateway);
  gateway.initialize(wss);

  console.log(`🚀 Streaming service running on http://localhost:${port}`);
  console.log(`📡 WebSocket server running on ws://localhost:${port}/streaming/ws`);
}
bootstrap();
