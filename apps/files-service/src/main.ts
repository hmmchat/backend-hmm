import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./modules/app.module.js";
import { ConfigService } from "@nestjs/config";
import { ZodExceptionFilter } from "./filters/zod-exception.filter.js";
import multipart from "fastify-multipart";

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: true,
      requestTimeout: 8000  // 8 second request timeout (less than gateway's 10s)
    })
  );

  // Register multipart plugin for file uploads (align max size with IMAGE_MAX_FILE_SIZE_MB)
  const uploadMaxMb = parseInt(process.env.FILE_UPLOAD_MAX_SIZE_MB || "10", 10);
  await app.register(multipart, {
    limits: {
      fileSize: uploadMaxMb * 1024 * 1024,
      files: 1
    }
  });

  const config = app.get(ConfigService);
  const port = config.get<number>("PORT") || 3008;

  const origins = (process.env.ALLOWED_ORIGINS ?? "").split(",").filter(Boolean);
  app.enableCors({
    origin: origins.length ? origins : true,
    credentials: true
  });

  // Register global exception filter for Zod validation errors
  app.useGlobalFilters(new ZodExceptionFilter());

  await app.listen(port, "0.0.0.0");
  console.log(`🚀 Files service running on http://localhost:${port}`);
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
