import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { HealthChecker, HealthCheckResult, ServiceDiscovery } from "@hmm/common";

@Controller()
export class HealthController {
  constructor(private prisma: PrismaService) {}

  @Get("health")
  async healthCheck(): Promise<HealthCheckResult> {
    const dbCheck = await HealthChecker.checkDatabase(this.prisma, "user-service");
    
    // Check optional dependencies
    const discovery = ServiceDiscovery.getInstance();
    const dependencies: HealthCheckResult['dependencies'] = {};
    
    // Check moderation service (optional)
    try {
      const moderationUrl = discovery.getServiceUrl("moderation-service");
      const moderationCheck = await HealthChecker.checkService(moderationUrl, 3000);
      dependencies["moderation-service"] = {
        status: moderationCheck.status,
        url: moderationUrl,
        responseTime: moderationCheck.responseTime,
        error: moderationCheck.error
      };
    } catch (error) {
      dependencies["moderation-service"] = {
        status: "down",
        error: error instanceof Error ? error.message : String(error)
      };
    }

    // Check wallet service (optional)
    try {
      const walletUrl = discovery.getServiceUrl("wallet-service");
      const walletCheck = await HealthChecker.checkService(walletUrl, 3000);
      dependencies["wallet-service"] = {
        status: walletCheck.status,
        url: walletUrl,
        responseTime: walletCheck.responseTime,
        error: walletCheck.error
      };
    } catch (error) {
      dependencies["wallet-service"] = {
        status: "down",
        error: error instanceof Error ? error.message : String(error)
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
