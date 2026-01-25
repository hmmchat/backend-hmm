import { Controller, Get, HttpCode, HttpStatus } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { HealthChecker, HealthCheckResult, ServiceDiscovery } from "@hmm/common";

@Controller()
export class HealthController {
  constructor(private prisma: PrismaService) {}

  @Get("ready")
  @HttpCode(HttpStatus.OK)
  async readinessCheck(): Promise<{ status: string; timestamp: string; message?: string }> {
    // Readiness check - only database, no dependencies
    try {
      const dbCheck = await HealthChecker.checkDatabase(this.prisma, "user-service");
      
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
    const dbCheck = await HealthChecker.checkDatabase(this.prisma, "user-service");
    
    // Check optional dependencies in parallel
    const discovery = ServiceDiscovery.getInstance();
    const dependencies: HealthCheckResult['dependencies'] = {};
    
    // Check dependencies in parallel with reduced timeout (1000ms)
    const dependencyChecks = [
      { name: "moderation-service", url: discovery.getServiceUrl("moderation-service") },
      { name: "wallet-service", url: discovery.getServiceUrl("wallet-service") }
    ].map(async ({ name, url }) => {
      try {
        const check = await HealthChecker.checkService(url, 1000); // Reduced to 1000ms
        return {
          name,
          check,
          url
        };
      } catch (error) {
        return {
          name,
          check: {
            status: "down" as const,
            error: error instanceof Error ? error.message : String(error)
          },
          url
        };
      }
    });
    
    // Wait for all dependency checks in parallel
    const results = await Promise.all(dependencyChecks);
    
    // Build dependencies object
    for (const { name, check, url } of results) {
      dependencies[name] = {
        status: check.status,
        url,
        responseTime: check.responseTime,
        error: check.error
      };
    }
    
    return HealthChecker.createResponse(
      "user-service",
      {
        database: dbCheck
      },
      dependencies,
      process.env.npm_package_version || "1.0.0"
    );
  }
}
