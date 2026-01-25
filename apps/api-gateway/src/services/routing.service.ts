import { Injectable, OnModuleInit, HttpException, HttpStatus, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import fetch from "node-fetch";
import { v4 as uuidv4 } from "uuid";

export interface RouteConfig {
  path: string;
  serviceUrl: string;
  requiresAuth?: boolean;
  timeout?: number;
}

interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  state: 'open' | 'half-open' | 'closed';
}

@Injectable()
export class RoutingService implements OnModuleInit {
  private readonly logger = new Logger(RoutingService.name);
  private routes: Map<string, RouteConfig> = new Map();
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();
  private readonly CIRCUIT_BREAKER_THRESHOLD = 5; // Open after 5 failures (less aggressive)
  private readonly CIRCUIT_BREAKER_TIMEOUT = 15000; // 15 seconds before attempting recovery (faster recovery)
  private readonly CIRCUIT_BREAKER_WINDOW = 60000; // 1 minute window for failure counting

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    // Load service URLs from environment variables
    const authServiceUrl = this.configService.get<string>("AUTH_SERVICE_URL") || "http://localhost:3001";
    const userServiceUrl = this.configService.get<string>("USER_SERVICE_URL") || "http://localhost:3002";
    const moderationServiceUrl = this.configService.get<string>("MODERATION_SERVICE_URL") || "http://localhost:3003";
    const discoveryServiceUrl = this.configService.get<string>("DISCOVERY_SERVICE_URL") || "http://localhost:3004";
    const streamingServiceUrl = this.configService.get<string>("STREAMING_SERVICE_URL") || "http://localhost:3006";
    const walletServiceUrl = this.configService.get<string>("WALLET_SERVICE_URL") || "http://localhost:3005";
    const friendServiceUrl = this.configService.get<string>("FRIEND_SERVICE_URL") || "http://localhost:3009";
    const filesServiceUrl = this.configService.get<string>("FILES_SERVICE_URL") || "http://localhost:3008";
    const paymentServiceUrl = this.configService.get<string>("PAYMENT_SERVICE_URL") || "http://localhost:3007";

    // Define routes (order matters - more specific routes first)
    this.routes.set("/me", {
      path: "/me",
      serviceUrl: userServiceUrl,
      requiresAuth: true
    });

    // /users/me is a protected endpoint
    this.routes.set("/users/me", {
      path: "/users/me",
      serviceUrl: userServiceUrl,
      requiresAuth: true
    });

    this.routes.set("/users", {
      path: "/users",
      serviceUrl: userServiceUrl,
      requiresAuth: false // Some endpoints are public (like /users/:id for public profiles)
    });

    this.routes.set("/auth", {
      path: "/auth",
      serviceUrl: authServiceUrl,
      requiresAuth: false
    });

    this.routes.set("/moderation", {
      path: "/moderation",
      serviceUrl: moderationServiceUrl,
      requiresAuth: false
    });

    this.routes.set("/discovery", {
      path: "/discovery",
      serviceUrl: discoveryServiceUrl,
      requiresAuth: true
    });

    this.routes.set("/squad", {
      path: "/squad",
      serviceUrl: discoveryServiceUrl,
      requiresAuth: true
    });

    this.routes.set("/location", {
      path: "/location",
      serviceUrl: discoveryServiceUrl,
      requiresAuth: true
    });

    this.routes.set("/gender-filters", {
      path: "/gender-filters",
      serviceUrl: discoveryServiceUrl,
      requiresAuth: true
    });

    this.routes.set("/homepage", {
      path: "/homepage",
      serviceUrl: discoveryServiceUrl, // Will be handled by aggregation service
      requiresAuth: true
    });

    this.routes.set("/streaming", {
      path: "/streaming",
      serviceUrl: streamingServiceUrl,
      requiresAuth: true
    });

    this.routes.set("/wallet", {
      path: "/wallet",
      serviceUrl: walletServiceUrl,
      requiresAuth: true
    });

    this.routes.set("/friends", {
      path: "/friends",
      serviceUrl: friendServiceUrl,
      requiresAuth: true
    });

    this.routes.set("/files", {
      path: "/files",
      serviceUrl: filesServiceUrl,
      requiresAuth: false // Some endpoints don't require auth
    });

    this.routes.set("/payments", {
      path: "/payments",
      serviceUrl: paymentServiceUrl,
      requiresAuth: true
    });

    // Catalog endpoints (public)
    this.routes.set("/brands", {
      path: "/brands",
      serviceUrl: userServiceUrl,
      requiresAuth: false
    });

    this.routes.set("/interests", {
      path: "/interests",
      serviceUrl: userServiceUrl,
      requiresAuth: false
    });

    this.routes.set("/values", {
      path: "/values",
      serviceUrl: userServiceUrl,
      requiresAuth: false
    });

    this.routes.set("/music", {
      path: "/music",
      serviceUrl: userServiceUrl,
      requiresAuth: false
    });

    this.logger.log("Route configuration loaded");
  }

  /**
   * Find route configuration for a given path
   */
  findRoute(path: string): RouteConfig | null {
    // Remove leading /v1 if present
    let cleanPath = path.replace(/^\/v1/, "");
    
    // Ensure path starts with /
    if (!cleanPath.startsWith("/")) {
      cleanPath = "/" + cleanPath;
    }

    // Try exact match first
    const exactMatch = this.routes.get(cleanPath);
    if (exactMatch) {
      return exactMatch;
    }

    // Then try prefix match, prioritizing longer/more specific paths
    const matchingRoutes: Array<{ path: string; config: RouteConfig }> = [];
    for (const [routePath, config] of this.routes.entries()) {
      if (cleanPath.startsWith(routePath + "/")) {
        matchingRoutes.push({ path: routePath, config });
      }
    }

    // Sort by path length (longer = more specific) and return the most specific match
    if (matchingRoutes.length > 0) {
      matchingRoutes.sort((a, b) => b.path.length - a.path.length);
      return matchingRoutes[0].config;
    }

    return null;
  }

  /**
   * Proxy request to backend service
   */
  async proxyRequest(
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: any,
    correlationId?: string
  ): Promise<{ status: number; data: any; headers: Record<string, string> }> {
    const route = this.findRoute(path);

    if (!route) {
      throw new HttpException(`No route found for path: ${path}`, HttpStatus.NOT_FOUND);
    }

    // Remove /v1 prefix from path for service routing
    let cleanPath = path.replace(/^\/v1/, "");
    
    // Ensure path starts with /
    if (!cleanPath.startsWith("/")) {
      cleanPath = "/" + cleanPath;
    }

    // Remove the route prefix from the path to get the service-specific path
    // Most services expect the route prefix (e.g., /users/123, /discovery/card)
    // But wallet service expects NO route prefix (e.g., /test/wallet/add-coins, not /wallet/test/wallet/add-coins)
    let servicePath = cleanPath;

    // Special case: auth, files, moderation expose /health at root only; gateway uses /auth/health, /files/health, /moderation/health
    if (cleanPath === "/auth/health" && route.path === "/auth") {
      servicePath = "/health";
    } else if (cleanPath === "/files/health" && route.path === "/files") {
      servicePath = "/health";
    } else if (cleanPath === "/moderation/health" && route.path === "/moderation") {
      servicePath = "/health";
    } else if (route.path === "/wallet" && cleanPath.startsWith("/wallet/")) {
      // Strip /wallet prefix for wallet service
      servicePath = cleanPath.substring("/wallet".length);
      if (!servicePath) {
        servicePath = "/";
      }
    } else if (cleanPath.startsWith(route.path + "/")) {
      // Path starts with route path + /, keep route prefix (most services expect it)
      servicePath = cleanPath;
    } else if (cleanPath === route.path) {
      // Path exactly matches route path, use root
      servicePath = "/";
    } else if (cleanPath.startsWith(route.path)) {
      // Path starts with route path (but no trailing /), use as-is (for routes like /me where service expects /me prefix)
      servicePath = cleanPath;
    } else {
      // Remove first segment if it doesn't match route path
      servicePath = cleanPath.replace(/^\/[^/]+/, "");
      if (!servicePath) {
        servicePath = "/";
      }
    }

    const url = `${route.serviceUrl}${servicePath}`;
    const timeout = route.timeout || 10000; // 10 second default timeout (reduced from 30s)

    // Prepare headers
    const requestHeaders: Record<string, string> = {
      ...headers,
      "x-correlation-id": correlationId || uuidv4(),
      "x-forwarded-by": "api-gateway"
    };

    // Remove host header (let service set it)
    delete requestHeaders.host;

    // Check circuit breaker
    const circuitBreaker = this.getCircuitBreaker(route.serviceUrl);
    if (circuitBreaker.state === 'open') {
      const timeSinceLastFailure = Date.now() - circuitBreaker.lastFailure;
      if (timeSinceLastFailure < this.CIRCUIT_BREAKER_TIMEOUT) {
        // Circuit breaker is open, but try recovery attempt anyway (half-open state)
        // This allows services to recover even if health checks are failing
        circuitBreaker.state = 'half-open';
        this.logger.log(`Circuit breaker HALF-OPEN for ${route.serviceUrl}, attempting recovery`);
      } else {
        // Enough time has passed, attempt recovery
        circuitBreaker.state = 'half-open';
        this.logger.log(`Circuit breaker HALF-OPEN for ${route.serviceUrl}, attempting recovery`);
      }
    }

    // Retry logic with exponential backoff
    const maxRetries = 2;
    let lastError: any = null;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const backoffDelay = Math.min(100 * Math.pow(2, attempt - 1), 200); // 100ms, 200ms
        this.logger.log(`Retrying request to ${url} (attempt ${attempt + 1}/${maxRetries + 1}) after ${backoffDelay}ms`);
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const fetchOptions: any = {
          method,
          headers: requestHeaders,
          signal: controller.signal as any
        };

        if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
          if (typeof body === "string") {
            requestHeaders["content-type"] = "application/json";
            fetchOptions.body = body;
          } else {
            requestHeaders["content-type"] = "application/json";
            fetchOptions.body = JSON.stringify(body);
          }
        }

        const response = await fetch(url, fetchOptions);
        clearTimeout(timeoutId);

        // Success - reset circuit breaker completely
        if (circuitBreaker.state === 'half-open') {
          circuitBreaker.state = 'closed';
          circuitBreaker.failures = 0;
          circuitBreaker.lastFailure = 0;
          this.logger.log(`Circuit breaker CLOSED for ${route.serviceUrl} after successful recovery`);
        } else if (circuitBreaker.state === 'closed') {
          // Reset failure count on success
          circuitBreaker.failures = 0;
          circuitBreaker.lastFailure = 0;
        }

        const responseData = await response.json().catch(() => ({}));
        const responseHeaders: Record<string, string> = {};
        
        // Copy relevant headers
        response.headers.forEach((value, key) => {
          if (key.toLowerCase() !== "transfer-encoding") {
            responseHeaders[key] = value;
          }
        });

        return {
          status: response.status,
          data: responseData,
          headers: responseHeaders
        };
      } catch (error: any) {
        lastError = error;
        
        // Don't retry on certain errors (4xx client errors, AbortError on last attempt)
        if (error.name === "AbortError" && attempt === maxRetries) {
          // Final timeout - record failure and throw
          this.recordFailure(route.serviceUrl);
          throw new HttpException(
            `Request timeout after ${timeout}ms: ${url}`,
            HttpStatus.GATEWAY_TIMEOUT
          );
        }
        
        // Check if error is retryable (network errors, timeouts)
        const isRetryable = this.isRetryableError(error);
        if (!isRetryable || attempt === maxRetries) {
          // Not retryable or last attempt - record failure and throw
          // Only record failure if it's not a transient network error during startup
          const isTransientNetworkError = error.message && (
            error.message.includes("ECONNREFUSED") ||
            error.message.includes("fetch failed") ||
            error.message.includes("network")
          );
          
          if (!isTransientNetworkError || attempt === maxRetries) {
            this.recordFailure(route.serviceUrl);
          }
          throw this.createErrorResponse(error, url, timeout);
        }
        
        // Retryable error - continue to next attempt
        this.logger.warn(`Retryable error on attempt ${attempt + 1} for ${url}: ${error.message}`);
      }
    }

    // Should never reach here, but just in case
    this.recordFailure(route.serviceUrl);
    throw this.createErrorResponse(lastError, url, timeout);
  }

  /**
   * Get circuit breaker state for a service URL
   */
  private getCircuitBreaker(serviceUrl: string): CircuitBreakerState {
    if (!this.circuitBreakers.has(serviceUrl)) {
      this.circuitBreakers.set(serviceUrl, {
        failures: 0,
        lastFailure: 0,
        state: 'closed'
      });
    }
    return this.circuitBreakers.get(serviceUrl)!;
  }

  /**
   * Record a failure for circuit breaker tracking
   */
  private recordFailure(serviceUrl: string): void {
    const breaker = this.getCircuitBreaker(serviceUrl);
    const now = Date.now();
    
    // Reset failure count if outside the time window
    if (now - breaker.lastFailure > this.CIRCUIT_BREAKER_WINDOW) {
      breaker.failures = 0;
    }
    
    breaker.failures++;
    breaker.lastFailure = now;
    
    // Open circuit breaker if threshold exceeded
    // Only open if we have persistent failures (not just startup issues)
    if (breaker.failures >= this.CIRCUIT_BREAKER_THRESHOLD && breaker.state !== 'open') {
      breaker.state = 'open';
      this.logger.error(`Circuit breaker OPENED for ${serviceUrl} after ${breaker.failures} failures`);
    }
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: any): boolean {
    // Retry on network errors, timeouts, and 5xx errors
    // Don't retry on 4xx client errors
    if (error.name === "AbortError") {
      return true; // Timeout - retryable
    }
    
    if (error.message) {
      const msg = error.message.toLowerCase();
      if (msg.includes('econnrefused') || msg.includes('enotfound') || 
          msg.includes('etimedout') || msg.includes('network') ||
          msg.includes('fetch failed')) {
        return true; // Network error - retryable
      }
    }
    
    // Check if it's an HttpException with 5xx status
    if (error instanceof HttpException) {
      const status = error.getStatus();
      return status >= 500 && status < 600; // 5xx errors are retryable
    }
    
    return false;
  }

  /**
   * Create appropriate error response based on error type
   */
  private createErrorResponse(error: any, url: string, timeout: number): HttpException {
    if (error.name === "AbortError") {
      return new HttpException(
        `Request timeout after ${timeout}ms: ${url}`,
        HttpStatus.GATEWAY_TIMEOUT
      );
    }
    
    // Check for connection refused errors
    if (error.message) {
      const msg = error.message.toLowerCase();
      if (msg.includes('econnrefused') || msg.includes('enotfound')) {
        return new HttpException(
          `Service unavailable: Connection refused to ${url}`,
          HttpStatus.BAD_GATEWAY
        );
      }
      if (msg.includes('etimedout')) {
        return new HttpException(
          `Service unavailable: Connection timeout to ${url}`,
          HttpStatus.GATEWAY_TIMEOUT
        );
      }
    }
    
    // Check if it's already an HttpException
    if (error instanceof HttpException) {
      return error;
    }
    
    // Default error
    this.logger.error(`Error proxying request to ${url}: ${error.message}`);
    return new HttpException(
      `Service unavailable: ${error.message || 'Unknown error'}`,
      HttpStatus.BAD_GATEWAY
    );
  }

  /**
   * Get all service URLs (for health checks)
   */
  getServiceUrls(): Map<string, string> {
    const serviceUrls = new Map<string, string>();
    for (const [path, config] of this.routes.entries()) {
      serviceUrls.set(path, config.serviceUrl);
    }
    return serviceUrls;
  }
}
