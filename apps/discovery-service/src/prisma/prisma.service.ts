import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
// Import PrismaClient with proper ESM handling
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
      // 
      // Recommended settings for production:
      // - connection_limit: 50-100 (depending on load)
      // - pool_timeout: 10 seconds
      //
      // If DATABASE_URL doesn't include these parameters, add them:
      // Example: DATABASE_URL="postgresql://...?connection_limit=50&pool_timeout=10"
      //
      // For high load (10K concurrent users), consider:
      // - connection_limit: 100
      // - Using a connection pooler like PgBouncer
    });
  }

  async onModuleInit() {
    await (this as any).$connect();
  }

  async onModuleDestroy() {
    await (this as any).$disconnect();
  }
}
