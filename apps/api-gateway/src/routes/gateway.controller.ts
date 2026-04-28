import {
  Controller,
  All,
  Req,
  Res,
  Headers,
  HttpException,
  HttpStatus,
  Logger
} from "@nestjs/common";
import { FastifyRequest, FastifyReply } from "fastify";
import { RoutingService } from "../services/routing.service.js";
import { AggregationService } from "../services/aggregation.service.js";
import { HealthService } from "../services/health.service.js";
import { RateLimitService } from "../services/rate-limit.service.js";
import { AuthMiddleware } from "../middleware/auth.middleware.js";
import { v4 as uuidv4 } from "uuid";

@Controller()
export class GatewayController {
  private readonly logger = new Logger(GatewayController.name);

  constructor(
    private readonly routingService: RoutingService,
    private readonly aggregationService: AggregationService,
    private readonly healthService: HealthService,
    private readonly rateLimitService: RateLimitService,
    private readonly authMiddleware: AuthMiddleware
  ) { }

  /**
   * Readiness endpoint - simple check that gateway is running
   * GET /ready
   */
  @All("ready")
  async readinessCheck(@Res() res: FastifyReply) {
    res.status(200).send({
      status: "ready",
      service: "api-gateway",
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Liveness endpoint - simple check that gateway is running
   * GET /health/live
   */
  @All("health/live")
  async healthLive(@Res() res: FastifyReply) {
    res.status(200).send({
      status: "healthy",
      service: "api-gateway",
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Health check endpoint - returns cached results immediately
   * GET /health
   */
  @All("health")
  async healthCheck(@Res() res: FastifyReply) {
    try {
      // Return cached results immediately (non-blocking)
      const health = await this.healthService.getOverallHealth(true);

      // Return 200 for healthy or degraded (70%+ services up)
      // Only return 503 for truly unhealthy (< 70% services)
      const statusCode = health.status === "unhealthy" ? 503 : 200;
      res.status(statusCode).send(health);

      // Trigger background update (don't await)
      this.healthService.getOverallHealth(false).catch(err => {
        this.logger.error(`Background health check update failed: ${err.message}`);
      });
    } catch (error: any) {
      res.status(503).send({
        status: "unhealthy",
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Homepage aggregation endpoint
   * GET /v1/homepage
   */
  @All("v1/homepage")
  async getHomepage(
    @Req() req: FastifyRequest,
    @Headers("authorization") authz: string,
    @Res() res: FastifyReply
  ) {
    const correlationId = uuidv4();
    this.logger.log(`[${correlationId}] Homepage request`);

    try {
      const token = this.authMiddleware.extractToken(authz);
      if (!token) {
        throw new HttpException("Missing authorization token", HttpStatus.UNAUTHORIZED);
      }

      // Verify token
      await this.authMiddleware.verifyToken(token);

      // Check rate limit
      const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
        (req.headers["x-real-ip"] as string) ||
        req.ip ||
        "unknown";
      const identifier = this.rateLimitService.getIdentifier({ authorization: authz }, ip);
      const rateLimit = await this.rateLimitService.checkRateLimit(identifier, "/homepage");

      if (!rateLimit.allowed) {
        res.status(429).send({
          error: "Rate limit exceeded",
          resetAt: rateLimit.resetAt
        });
        return;
      }

      // Get aggregated data
      const data = await this.aggregationService.getHomepage(token);

      res.header("X-RateLimit-Remaining", rateLimit.remaining.toString());
      res.header("X-RateLimit-Reset", rateLimit.resetAt.toString());
      res.status(200).send(data);
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(`[${correlationId}] Homepage error: ${error.message}`);
      throw new HttpException("Failed to fetch homepage data", HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Catch-all route handler for /v1/* requests
   * This proxies requests to appropriate backend services
   */
  @All("v1/*")
  async proxyRequest(
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply
  ) {
    const correlationId = uuidv4();
    const method = req.method;
    const fullUrl = req.url;
    const path = fullUrl.split("?")[0]; // Remove query string for routing
    const queryString = fullUrl.includes("?") ? fullUrl.split("?")[1] : "";

    this.logger.log(`[${correlationId}] ${method} ${path}`);

    try {
      // Get headers
      const headers: Record<string, string> = {};
      Object.keys(req.headers).forEach(key => {
        const value = req.headers[key];
        if (typeof value === "string") {
          headers[key] = value;
        } else if (Array.isArray(value) && value.length > 0) {
          headers[key] = value[0];
        }
      });

      // Get body
      let requestBody: any = undefined;
      if (method === "POST" || method === "PUT" || method === "PATCH") {
        const contentType = (req.headers["content-type"] || "").toLowerCase();
        if (contentType.includes("multipart/form-data")) {
          // Use the raw request stream for multipart proxying
          requestBody = req.raw;
        } else {
          requestBody = req.body;
        }
      }

      // Find route
      const route = this.routingService.findRoute(path);

      if (!route) {
        throw new HttpException(`No route found for: ${path}`, HttpStatus.NOT_FOUND);
      }

      if (process.env.NODE_ENV === "production" && path.includes("/test/")) {
        throw new HttpException("Not found", HttpStatus.NOT_FOUND);
      }

      // Check authentication if required
      // Use middleware's requiresAuth method to check path (bypasses /test/ endpoints)
      let userId: string | undefined;
      const pathRequiresAuth = this.authMiddleware.requiresAuth(path);
      if (pathRequiresAuth && route.requiresAuth) {
        const token = this.authMiddleware.extractToken(headers.authorization || headers.Authorization);
        if (!token) {
          throw new HttpException("Missing authorization token", HttpStatus.UNAUTHORIZED);
        }

        const verified = await this.authMiddleware.verifyToken(token);
        userId = verified.userId;
      }

      // Forward x-user-id to backend when auth was verified (e.g. for /streaming/history)
      if (userId) {
        headers["x-user-id"] = userId;
      }

      // Check rate limit
      const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
        (req.headers["x-real-ip"] as string) ||
        req.ip ||
        "unknown";
      const identifier = this.rateLimitService.getIdentifier(headers, ip);
      const rateLimit = await this.rateLimitService.checkRateLimit(identifier, path);

      if (!rateLimit.allowed) {
        res.status(429).send({
          error: "Rate limit exceeded",
          message: "Too many requests. Please try again later.",
          resetAt: rateLimit.resetAt
        });
        return;
      }

      // Proxy request to backend service
      const result = await this.routingService.proxyRequest(
        method,
        path + (queryString ? `?${queryString}` : ""),
        headers,
        requestBody,
        correlationId
      );

      // Set rate limit headers
      res.header("X-RateLimit-Remaining", rateLimit.remaining.toString());
      res.header("X-RateLimit-Reset", rateLimit.resetAt.toString());
      res.header("X-Correlation-Id", correlationId);

      // Copy response headers
      Object.entries(result.headers).forEach(([key, value]) => {
        if (key.toLowerCase() !== "transfer-encoding") {
          res.header(key, value);
        }
      });

      // Send response
      res.status(result.status).send(result.data);
    } catch (error: any) {
      if (error instanceof HttpException) {
        const status = error.getStatus();
        const response = error.getResponse();
        res.status(status).send(
          typeof response === "string" ? { error: response } : response
        );
        return;
      }

      this.logger.error(`[${correlationId}] Proxy error: ${error.message}`);
      res.status(HttpStatus.BAD_GATEWAY).send({
        error: "Service unavailable",
        message: error.message
      });
    }
  }
}
