import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./modules/app.module.js";
import { ConfigService } from "@nestjs/config";
import { ZodExceptionFilter } from "./filters/zod-exception.filter.js";

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true })
  );

  const config = app.get(ConfigService);
  const port = config.get<number>("PORT") || 3000;

  const origins = (process.env.ALLOWED_ORIGINS ?? "").split(",").filter(Boolean);
  app.enableCors({
    origin: origins.length ? origins : true,
    credentials: true
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
bootstrap();
