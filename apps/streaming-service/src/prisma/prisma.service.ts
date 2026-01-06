import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "../../node_modules/.prisma/client/index.js";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({
      // Connection pool configuration
      // For PostgreSQL, connection pooling is configured via DATABASE_URL:
      // postgresql://user:password@host:port/database?connection_limit=50&pool_timeout=10
    });
  }

  async onModuleInit() {
    await (this as any).$connect();
  }

  async onModuleDestroy() {
    await (this as any).$disconnect();
  }
}
