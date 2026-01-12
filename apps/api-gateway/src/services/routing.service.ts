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

@Injectable()
export class RoutingService implements OnModuleInit {
  private readonly logger = new Logger(RoutingService.name);
  private routes: Map<string, RouteConfig> = new Map();

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    // Load service URLs from environment variables
    const authServiceUrl = this.configService.get<string>("AUTH_SERVICE_URL") || "http://localhost:3001";
    const userServiceUrl = this.configService.get<string>("USER_SERVICE_URL") || "http://localhost:3002";
    const discoveryServiceUrl = this.configService.get<string>("DISCOVERY_SERVICE_URL") || "http://localhost:3004";
    const streamingServiceUrl = this.configService.get<string>("STREAMING_SERVICE_URL") || "http://localhost:3005";
    const walletServiceUrl = this.configService.get<string>("WALLET_SERVICE_URL") || "http://localhost:3006";
    const friendServiceUrl = this.configService.get<string>("FRIEND_SERVICE_URL") || "http://localhost:3007";
    const filesServiceUrl = this.configService.get<string>("FILES_SERVICE_URL") || "http://localhost:3008";
    const paymentServiceUrl = this.configService.get<string>("PAYMENT_SERVICE_URL") || "http://localhost:3009";

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
    // Example: /v1/users/123 → /users/123 (route: /users)
    // Example: /v1/me/profile → /me/profile (route: /me)
    let servicePath = cleanPath;
    if (cleanPath.startsWith(route.path)) {
      // Path already starts with route path, use as-is
      servicePath = cleanPath;
    } else {
      // Remove first segment if it doesn't match route path
      servicePath = cleanPath.replace(/^\/[^/]+/, "");
      if (!servicePath) {
        servicePath = "/";
      }
    }

    const url = `${route.serviceUrl}${servicePath}`;
    const timeout = route.timeout || 30000; // 30 second default timeout

    // Prepare headers
    const requestHeaders: Record<string, string> = {
      ...headers,
      "x-correlation-id": correlationId || uuidv4(),
      "x-forwarded-by": "api-gateway"
    };

    // Remove host header (let service set it)
    delete requestHeaders.host;

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
      if (error.name === "AbortError") {
        throw new HttpException(
          `Request timeout after ${timeout}ms: ${url}`,
          HttpStatus.REQUEST_TIMEOUT
        );
      }

      this.logger.error(`Error proxying request to ${url}: ${error.message}`);
      throw new HttpException(
        `Service unavailable: ${error.message}`,
        HttpStatus.BAD_GATEWAY
      );
    }
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
