import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import fetch from "node-fetch";

export interface ServiceHealth {
  name: string;
  url: string;
  status: "healthy" | "unhealthy" | "unknown";
  responseTime?: number;
  error?: string;
}

interface CachedHealth {
  services: ServiceHealth[];
  timestamp: number;
}

interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
}

@Injectable()
export class HealthService implements OnModuleDestroy {
  private readonly logger = new Logger(HealthService.name);
  private healthCache: CachedHealth | null = null;
  private readonly CACHE_TTL = 8000; // 8 seconds
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();
  private readonly CIRCUIT_BREAKER_THRESHOLD = 5; // Increased from 3 to 5 to be less aggressive
  private readonly CIRCUIT_BREAKER_WINDOW = 60000; // 1 minute
  private readonly CIRCUIT_BREAKER_RECOVERY = 15000; // Reduced to 15 seconds for faster recovery
  private backgroundUpdateInterval: NodeJS.Timeout | null = null;

  constructor(
    private configService: ConfigService
  ) {
    // Start background health check updates
    this.startBackgroundUpdates();
  }

  /**
   * Start background health check updates
   */
  private startBackgroundUpdates(): void {
    // Update health checks in background every 8 seconds
    this.backgroundUpdateInterval = setInterval(async () => {
      try {
        await this.updateHealthCache();
      } catch (error) {
        this.logger.error(`Background health check update failed: ${error}`);
      }
    }, this.CACHE_TTL);
  }

  /**
   * Update health cache in background
   */
  private async updateHealthCache(): Promise<void> {
    const services: { name: string; url: string; healthPath?: string }[] = [
      { name: "auth-service", url: this.configService.get<string>("AUTH_SERVICE_URL") || "http://localhost:3001" },
      { name: "user-service", url: this.configService.get<string>("USER_SERVICE_URL") || "http://localhost:3002" },
      { name: "moderation-service", url: this.configService.get<string>("MODERATION_SERVICE_URL") || "http://localhost:3003" },
      { name: "discovery-service", url: this.configService.get<string>("DISCOVERY_SERVICE_URL") || "http://localhost:3004" },
      { name: "streaming-service", url: this.configService.get<string>("STREAMING_SERVICE_URL") || "http://localhost:3006" },
      { name: "wallet-service", url: this.configService.get<string>("WALLET_SERVICE_URL") || "http://localhost:3005" },
      { name: "friend-service", url: this.configService.get<string>("FRIEND_SERVICE_URL") || "http://localhost:3009" },
      { name: "files-service", url: this.configService.get<string>("FILES_SERVICE_URL") || "http://localhost:3008" },
      { name: "payment-service", url: this.configService.get<string>("PAYMENT_SERVICE_URL") || "http://localhost:3007", healthPath: "/v1/payments/health" },
      { name: "ads-service", url: this.configService.get<string>("ADS_SERVICE_URL") || "http://localhost:3010" }
    ];

    const healthChecks = await Promise.all(
      services.map(service => this.checkService(service.name, service.url, service.healthPath))
    );

    this.healthCache = {
      services: healthChecks,
      timestamp: Date.now()
    };
  }

  /**
   * Check health of all services (returns cached if available)
   */
  async checkAllServices(useCache: boolean = true): Promise<ServiceHealth[]> {
    // Return cached results if available and fresh
    if (useCache && this.healthCache) {
      const age = Date.now() - this.healthCache.timestamp;
      if (age < this.CACHE_TTL) {
        return this.healthCache.services;
      }
    }

    // If no cache or cache expired, trigger background update and return what we have
    if (!this.healthCache) {
      // First call - update synchronously
      await this.updateHealthCache();
      return this.healthCache!.services;
    }

    // Cache exists but expired - return stale cache and update in background
    this.updateHealthCache().catch(err => {
      this.logger.error(`Failed to update health cache: ${err}`);
    });
    return this.healthCache.services;
  }

  /**
   * Check health of a single service
   */
  private async checkService(name: string, url: string, healthPath: string = "/health"): Promise<ServiceHealth> {
    const startTime = Date.now();
    const path = healthPath.startsWith("/") ? healthPath : `/${healthPath}`;

    // Check circuit breaker
    const breaker = this.getCircuitBreaker(name);
    const now = Date.now();
    
    // Reset failure count if outside time window
    if (now - breaker.lastFailure > this.CIRCUIT_BREAKER_WINDOW) {
      breaker.failures = 0;
    }
    
    // Skip check if circuit breaker is open and not enough time has passed
    // But allow recovery attempts after timeout
    if (breaker.failures >= this.CIRCUIT_BREAKER_THRESHOLD) {
      const timeSinceLastFailure = now - breaker.lastFailure;
      if (timeSinceLastFailure < this.CIRCUIT_BREAKER_RECOVERY) {
        // Still in circuit breaker timeout, but reduce failure count to allow recovery
        // Don't completely skip - try the check to see if service recovered
        breaker.failures = Math.max(0, breaker.failures - 1); // Gradually reduce failures
      } else {
        // Enough time passed, attempt recovery
        breaker.failures = Math.floor(breaker.failures / 2); // Reduce failure count for recovery attempt
      }
    }

    try {
      // Use longer timeout for services with dependency checks
      // Services like streaming-service, user-service, discovery-service check dependencies
      // and can take 5-10 seconds when all services are starting up
      const timeout = name.includes("streaming") || name.includes("user") || name.includes("discovery") 
        ? 15000  // 15s for services with dependency checks
        : 5000;  // 5s for simple services
      const response = await fetch(`${url}${path}`, {
        method: "GET",
        signal: AbortSignal.timeout(timeout) as any
      });

      const responseTime = Date.now() - startTime;

      if (response.ok) {
        // Success - reset circuit breaker completely
        breaker.failures = 0;
        breaker.lastFailure = 0;
        return {
          name,
          url,
          status: "healthy",
          responseTime
        };
      } else {
        // HTTP error - record failure
        this.recordFailure(name);
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
      // Don't record failure for network errors during startup (services might be starting)
      // Only record failures for actual service errors, not connection timeouts during startup
      const errorMsg = error.message || "Connection failed";
      const isNetworkError = errorMsg.includes("fetch failed") || 
                            errorMsg.includes("ECONNREFUSED") || 
                            errorMsg.includes("ETIMEDOUT") ||
                            errorMsg.includes("timeout");
      
      // For network errors, don't immediately open circuit breaker - might be temporary
      if (!isNetworkError) {
        this.recordFailure(name);
      }
      
      return {
        name,
        url,
        status: "unhealthy",
        responseTime,
        error: errorMsg
      };
    }
  }

  /**
   * Get circuit breaker state for a service
   */
  private getCircuitBreaker(serviceName: string): CircuitBreakerState {
    if (!this.circuitBreakers.has(serviceName)) {
      this.circuitBreakers.set(serviceName, {
        failures: 0,
        lastFailure: 0
      });
    }
    return this.circuitBreakers.get(serviceName)!;
  }

  /**
   * Record a failure for circuit breaker
   */
  private recordFailure(serviceName: string): void {
    const breaker = this.getCircuitBreaker(serviceName);
    const now = Date.now();
    
    // Reset failure count if outside time window
    if (now - breaker.lastFailure > this.CIRCUIT_BREAKER_WINDOW) {
      breaker.failures = 0;
    }
    
    breaker.failures++;
    breaker.lastFailure = now;
    
    if (breaker.failures >= this.CIRCUIT_BREAKER_THRESHOLD) {
      this.logger.warn(`Circuit breaker opened for ${serviceName} after ${breaker.failures} failures`);
    }
  }

  /**
   * Get overall health status (uses cache for fast response)
   */
  async getOverallHealth(useCache: boolean = true): Promise<{
    status: "healthy" | "degraded" | "unhealthy";
    services: ServiceHealth[];
    timestamp: string;
  }> {
    const services = await this.checkAllServices(useCache);
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

  /**
   * Cleanup on module destroy
   */
  onModuleDestroy(): void {
    if (this.backgroundUpdateInterval) {
      clearInterval(this.backgroundUpdateInterval);
    }
  }
}
