import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./modules/app.module.js";
import { ConfigService } from "@nestjs/config";
import { ZodExceptionFilter } from "./filters/zod-exception.filter.js";
import multipart from "@fastify/multipart";

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: true,
      requestTimeout: 12000  // 12 second request timeout (slightly more than proxy timeout)
    })
  );

  // Register multipart plugin for file uploads
  await app.register(multipart, {
    attachFieldsToBody: true
  });

  const config = app.get(ConfigService);
  const port = config.get<number>("PORT") || 3000;

  const origins = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  const isDev = !process.env.NODE_ENV || process.env.NODE_ENV === "development";

  app.enableCors({
    origin: origins.length
      ? (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => {
        // Allow requested origin if in whitelist; also allow null (file://) in dev
        if ((!origin || origin === "null") && isDev) return cb(null, true);
        if (origin && origins.includes(origin)) return cb(null, true);
        cb(null, false);
      }
      : true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept"]
  });

  // Register global exception filter for Zod validation errors
  app.useGlobalFilters(new ZodExceptionFilter());

  // Note: We don't set global prefix because:
  // - /health should be accessible without /v1
  // - /v1/* routes are handled by the controller

  await app.listen(port, "0.0.0.0");
  console.log(`🚀 API Gateway running on http://localhost:${port}`);
  console.log(`📡 Routes available under /v1/*`);
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
