import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { HealthChecker, HealthCheckResult } from "@hmm/common";

@Controller()
export class HealthController {
  constructor(private prisma: PrismaService) {}

  @Get("health")
  async healthCheck(): Promise<HealthCheckResult> {
    const dbCheck = await HealthChecker.checkDatabase(this.prisma, "wallet-service");
    
    return HealthChecker.createResponse(
      "wallet-service",
      {
        database: dbCheck
      },
      undefined,
      process.env.npm_package_version || "0.0.1"
    );
  }
}
