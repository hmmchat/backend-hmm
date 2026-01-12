import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import fetch from "node-fetch";

export interface ServiceHealth {
  name: string;
  url: string;
  status: "healthy" | "unhealthy" | "unknown";
  responseTime?: number;
  error?: string;
}

@Injectable()
export class HealthService {
  constructor(
    private configService: ConfigService
  ) {}

  /**
   * Check health of all services
   */
  async checkAllServices(): Promise<ServiceHealth[]> {
    const services = [
      { name: "auth-service", url: this.configService.get<string>("AUTH_SERVICE_URL") || "http://localhost:3001" },
      { name: "user-service", url: this.configService.get<string>("USER_SERVICE_URL") || "http://localhost:3002" },
      { name: "moderation-service", url: this.configService.get<string>("MODERATION_SERVICE_URL") || "http://localhost:3003" },
      { name: "discovery-service", url: this.configService.get<string>("DISCOVERY_SERVICE_URL") || "http://localhost:3004" },
      { name: "streaming-service", url: this.configService.get<string>("STREAMING_SERVICE_URL") || "http://localhost:3005" },
      { name: "wallet-service", url: this.configService.get<string>("WALLET_SERVICE_URL") || "http://localhost:3006" },
      { name: "friend-service", url: this.configService.get<string>("FRIEND_SERVICE_URL") || "http://localhost:3007" },
      { name: "files-service", url: this.configService.get<string>("FILES_SERVICE_URL") || "http://localhost:3008" },
      { name: "payment-service", url: this.configService.get<string>("PAYMENT_SERVICE_URL") || "http://localhost:3009" }
    ];

    const healthChecks = await Promise.all(
      services.map(service => this.checkService(service.name, service.url))
    );

    return healthChecks;
  }

  /**
   * Check health of a single service
   */
  private async checkService(name: string, url: string): Promise<ServiceHealth> {
    const startTime = Date.now();
    
    try {
      const response = await fetch(`${url}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(5000) as any
      });

      const responseTime = Date.now() - startTime;

      if (response.ok) {
        return {
          name,
          url,
          status: "healthy",
          responseTime
        };
      } else {
        return {
          name,
          url,
          status: "unhealthy",
          responseTime,
          error: `HTTP ${response.status}`
        };
      }
    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      return {
        name,
        url,
        status: "unhealthy",
        responseTime,
        error: error.message || "Connection failed"
      };
    }
  }

  /**
   * Get overall health status
   */
  async getOverallHealth(): Promise<{
    status: "healthy" | "degraded" | "unhealthy";
    services: ServiceHealth[];
    timestamp: string;
  }> {
    const services = await this.checkAllServices();
    const healthyCount = services.filter(s => s.status === "healthy").length;
    const totalCount = services.length;

    let status: "healthy" | "degraded" | "unhealthy";
    if (healthyCount === totalCount) {
      status = "healthy";
    } else if (healthyCount >= totalCount * 0.7) {
      status = "degraded"; // 70%+ services healthy
    } else {
      status = "unhealthy";
    }

    return {
      status,
      services,
      timestamp: new Date().toISOString()
    };
  }
}
