import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { HealthChecker, HealthCheckResult, ServiceDiscovery } from "@hmm/common";
import { RedisService } from "../services/redis.service.js";

@Controller()
export class HealthController {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService
  ) {}

  @Get("health")
  async healthCheck(): Promise<HealthCheckResult> {
    const dbCheck = await HealthChecker.checkDatabase(this.prisma, "friend-service");
    
    // Check Redis
    let redisCheck: { status: "up" | "down"; message?: string; responseTime?: number } = { 
      status: "down" as const, 
      message: "Redis not configured" 
    };
    try {
      const redisClient = this.redis?.getClient();
      if (redisClient) {
        redisCheck = await HealthChecker.checkRedis(redisClient, "friend-service");
      }
    } catch (error) {
      redisCheck = {
        status: "down",
        message: error instanceof Error ? error.message : "Redis check failed"
      };
    }

    // Check optional dependencies
    const discovery = ServiceDiscovery.getInstance();
    const dependencies: HealthCheckResult['dependencies'] = {};
    
    const dependencyServices = ["user-service", "wallet-service", "streaming-service"];
    for (const serviceName of dependencyServices) {
      try {
        const url = discovery.getServiceUrl(serviceName);
        const check = await HealthChecker.checkService(url, 3000);
        dependencies[serviceName] = {
          status: check.status,
          url,
          responseTime: check.responseTime,
          error: check.error
        };
      } catch (error) {
        dependencies[serviceName] = {
          status: "down",
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
    
    return HealthChecker.createResponse(
      "friend-service",
      {
        database: dbCheck,
        redis: redisCheck
      },
      dependencies,
      process.env.npm_package_version || "0.0.1"
    );
  }
}
