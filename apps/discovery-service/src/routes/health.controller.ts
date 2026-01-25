import { Controller, Get, HttpCode, HttpStatus } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { HealthChecker, HealthCheckResult, ServiceDiscovery } from "@hmm/common";
import { CacheService } from "../services/cache.service.js";

@Controller()
export class HealthController {
  constructor(
    private prisma: PrismaService,
    private cache: CacheService
  ) {}

  @Get("ready")
  @HttpCode(HttpStatus.OK)
  async readinessCheck(): Promise<{ status: string; timestamp: string; message?: string }> {
    // Readiness check - only database, no dependencies
    try {
      const dbCheck = await HealthChecker.checkDatabase(this.prisma, "discovery-service");
      
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
    const dbCheck = await HealthChecker.checkDatabase(this.prisma, "discovery-service");
    
    // Check Redis
    let redisCheck: { status: "up" | "down"; message?: string; responseTime?: number } = { 
      status: "down" as const, 
      message: "Redis not configured" 
    };
    try {
      const redisClient = this.cache?.getClient();
      if (redisClient) {
        redisCheck = await HealthChecker.checkRedis(redisClient, "discovery-service");
      }
    } catch (error) {
      redisCheck = {
        status: "down",
        message: error instanceof Error ? error.message : "Redis check failed"
      };
    }

    // Check dependencies in parallel with reduced timeout (1000ms)
    const discovery = ServiceDiscovery.getInstance();
    const dependencies: HealthCheckResult['dependencies'] = {};
    
    const dependencyServices = ["user-service", "friend-service", "wallet-service"];
    
    // Check all dependencies in parallel
    const dependencyChecks = dependencyServices.map(async (serviceName) => {
      try {
        const url = discovery.getServiceUrl(serviceName);
        const check = await HealthChecker.checkService(url, 1000); // Reduced to 1000ms
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
      "discovery-service",
      {
        database: dbCheck,
        redis: redisCheck
      },
      dependencies,
      process.env.npm_package_version || "0.0.1"
    );
  }
}
