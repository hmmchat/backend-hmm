/**
 * Enhanced User Client Service with Circuit Breaker and Graceful Degradation
 * 
 * This is an example implementation showing how to use ServiceClient
 * for graceful degradation. Other service clients can follow this pattern.
 */

import { Injectable, Logger } from "@nestjs/common";
import { ServiceClient, ServiceDiscovery } from "@hmm/common";

@Injectable()
export class UserClientEnhancedService {
  private readonly logger = new Logger(UserClientEnhancedService.name);
  private readonly client: ServiceClient;

  constructor() {
    const discovery = ServiceDiscovery.getInstance();
    const userServiceUrl = discovery.getServiceUrl("user-service");

    this.client = new ServiceClient({
      serviceName: "user-service",
      baseUrl: userServiceUrl,
      timeout: 5000,
      retries: 2,
      circuitBreakerThreshold: 5,
      circuitBreakerTimeout: 60000,
      fallback: async () => {
        this.logger.warn("User service unavailable, using fallback");
        return { users: [] }; // Return empty array as fallback
      },
      onFailure: (error) => {
        this.logger.error(`User service failure: ${error.message}`);
      }
    });
  }

  /**
   * Get users with graceful degradation
   */
  async getUsersForDiscovery(filters: any): Promise<any[]> {
    try {
      return await this.client.request<any[]>("/users/discovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(filters)
      });
    } catch (error: any) {
      // If fallback also fails, return empty array
      this.logger.error(`Failed to get users, using empty fallback: ${error.message}`);
      return [];
    }
  }

  /**
   * Get circuit breaker state (for monitoring)
   */
  getCircuitBreakerState() {
    return this.client.getState();
  }
}
