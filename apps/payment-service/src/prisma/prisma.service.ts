import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from "@nestjs/common";
import { PrismaClient } from "../../node_modules/.prisma/client/index.js";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private isConnected = false;

  async onModuleInit() {
    const isTestMode = process.env.NODE_ENV === "test" || process.env.ALLOW_TEST_MODE === "true";
    const hasDatabaseUrl = process.env.DATABASE_URL && process.env.DATABASE_URL !== "undefined";
    
    // Skip database connection in test mode if DATABASE_URL not set
    if (isTestMode && !hasDatabaseUrl) {
      this.logger.warn("⚠️  DATABASE_URL not configured - skipping database connection (test mode)");
      this.logger.warn("⚠️  Test endpoints will work, but DB operations will fail");
      return;
    }

    try {
      await this.$connect();
      this.isConnected = true;
      this.logger.log("✅ Database connected");
    } catch (error: any) {
      if (isTestMode) {
        this.logger.warn(`⚠️  Database connection failed in test mode: ${error.message}`);
        this.logger.warn("⚠️  Test endpoints will work, but DB operations will fail");
        // Don't throw - allow service to start for test endpoints
      } else {
        this.logger.error(`❌ Database connection failed: ${error.message}`);
        throw error;
      }
    }
  }

  async onModuleDestroy() {
    if (this.isConnected) {
      try {
        await this.$disconnect();
      } catch (error: any) {
        // Ignore disconnect errors
      }
    }
  }
}
