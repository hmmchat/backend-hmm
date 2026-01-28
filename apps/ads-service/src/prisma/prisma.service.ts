import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
// Import directly from generated client to avoid root-level @prisma/client resolution issues
import { PrismaClient } from "../../node_modules/.prisma/client/index.js";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    // Ensure DATABASE_URL is set from environment
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL environment variable is not set");
    }
    super({
      datasources: {
        db: {
          url: databaseUrl
        }
      }
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
