import { Controller, Get, HttpCode, HttpStatus } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { HealthChecker, HealthCheckResult } from "@hmm/common";

@Controller()
export class HealthController {
  constructor(private prisma: PrismaService) {}

  @Get("ready")
  @HttpCode(HttpStatus.OK)
  async readinessCheck(): Promise<{ status: string; timestamp: string; message?: string }> {
    // Readiness check - only database, no dependencies
    try {
      const dbCheck = await HealthChecker.checkDatabase(this.prisma, "wallet-service");
      
      if (dbCheck.status === 'up') {
        return {
          status: 'ready',
          timestamp: new Date().toISOString()
        };
      } else {
        return {
          status: 'not_ready',
          message: dbCheck.message,
          timestamp: new Date().toISOString()
        };
      }
    } catch (error: any) {
      return {
        status: 'not_ready',
        message: error.message || 'Database check failed',
        timestamp: new Date().toISOString()
      };
    }
  }

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
