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
      const dbCheck = await HealthChecker.checkDatabase(this.prisma, "streaming-service");
      
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
    const dbCheck = await HealthChecker.checkDatabase(this.prisma, "streaming-service");
    
    // Check optional dependencies IN PARALLEL (not sequential) with shorter timeout
    const discovery = ServiceDiscovery.getInstance();
    const dependencies: HealthCheckResult['dependencies'] = {};
    
    const dependencyServices = ["user-service", "discovery-service", "wallet-service", "friend-service"];
    
    // Check all dependencies in parallel to reduce total time from ~8s to ~1s
    const dependencyChecks = dependencyServices.map(async (serviceName) => {
      try {
        const url = discovery.getServiceUrl(serviceName);
        const check = await HealthChecker.checkService(url, 1000); // Reduced from 2000ms to 1000ms
        return { serviceName, check, url };
      } catch (error) {
        return { 
          serviceName, 
          check: { 
            status: "down" as const, 
            error: error instanceof Error ? error.message : String(error) 
          },
          url: discovery.getServiceUrl(serviceName)
        };
      }
    });
    
    // Wait for all dependency checks in parallel
    const results = await Promise.all(dependencyChecks);
    
    // Build dependencies object
    for (const { serviceName, check, url } of results) {
      dependencies[serviceName] = {
        status: check.status,
        url,
        responseTime: check.responseTime,
        error: check.error
      };
    }
    
    return HealthChecker.createResponse(
      "streaming-service",
      {
        database: dbCheck
      },
      dependencies,
      process.env.npm_package_version || "0.0.1"
    );
  }
}
