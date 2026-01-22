import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { HealthChecker, HealthCheckResult, ServiceDiscovery } from "@hmm/common";

@Controller()
export class HealthController {
  constructor(private prisma: PrismaService) {}

  @Get("health")
  async healthCheck(): Promise<HealthCheckResult> {
    const dbCheck = await HealthChecker.checkDatabase(this.prisma, "streaming-service");
    
    // Check optional dependencies
    const discovery = ServiceDiscovery.getInstance();
    const dependencies: HealthCheckResult['dependencies'] = {};
    
    const dependencyServices = ["user-service", "discovery-service", "wallet-service", "friend-service"];
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
      "streaming-service",
      {
        database: dbCheck
      },
      dependencies,
      process.env.npm_package_version || "0.0.1"
    );
  }
}
