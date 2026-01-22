import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
// Import directly from generated client to avoid root-level @prisma/client resolution issues
import { PrismaClient } from "../../node_modules/.prisma/client/index.js";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

