import { Injectable, HttpException, HttpStatus, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { verifyToken } from "@hmm/common";

@Injectable()
export class AuthMiddleware {
  private readonly logger = new Logger(AuthMiddleware.name);
  private publicJwk: any = null;
  private initialized = false;

  constructor(private configService: ConfigService) {}

  async initialize() {
    if (this.initialized) return;

    const jwkStr = this.configService.get<string>("JWT_PUBLIC_JWK");
    if (jwkStr && jwkStr !== "undefined") {
      try {
        const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
        this.publicJwk = JSON.parse(cleanedJwk);
        this.initialized = true;
      } catch (error) {
        this.logger.warn("Failed to parse JWT_PUBLIC_JWK");
      }
    }
  }

  /**
   * Verify JWT token
   */
  async verifyToken(token: string): Promise<{ userId: string; payload: any }> {
    await this.initialize();

    if (!this.publicJwk) {
      throw new HttpException("JWT configuration error", HttpStatus.INTERNAL_SERVER_ERROR);
    }

    try {
      const verifyAccess = await verifyToken(this.publicJwk);
      const payload = await verifyAccess(token);
      return { userId: payload.sub, payload };
    } catch (error: any) {
      throw new HttpException("Invalid or expired token", HttpStatus.UNAUTHORIZED);
    }
  }

  /**
   * Extract token from Authorization header
   */
  extractToken(authHeader?: string): string | null {
    if (!authHeader) return null;
    const [type, token] = authHeader.split(" ");
    return type?.toLowerCase() === "bearer" ? token : null;
  }

  /**
   * Check if path requires authentication
   */
  requiresAuth(path: string): boolean {
    // Test endpoints bypass authentication
    if (path.includes("/test/")) {
      return false;
    }

    // Location picker / geocode — public on discovery-service; gateway must match
    const pathNoQuery = path.split("?")[0];
    const withoutV1 = pathNoQuery.replace(/^\/v1(?=\/|$)/, "");
    const normalized = withoutV1.startsWith("/") ? withoutV1 : `/${withoutV1}`;
    if (/^\/location\/(cities|search|locate-me)$/.test(normalized)) {
      return false;
    }

    // Beam TV / HMM_TV public discovery endpoints (must work for anonymous viewers)
    // - GET /discovery/broadcasts/feed?sessionId=...&deviceId=...
    // - POST /discovery/broadcasts/viewed (anonymous uses deviceId)
    // - GET /discovery/broadcasts/:roomId (deep link)
    // - GET /discovery/broadcasts/:roomId/comments (public)
    // - POST /discovery/broadcasts/:roomId/share (auth optional)
    if (
      normalized === "/discovery/broadcasts/feed" ||
      normalized === "/discovery/broadcasts/viewed" ||
      /^\/discovery\/broadcasts\/[^/]+$/.test(normalized) ||
      /^\/discovery\/broadcasts\/[^/]+\/comments$/.test(normalized) ||
      /^\/discovery\/broadcasts\/[^/]+\/share$/.test(normalized)
    ) {
      return false;
    }

    // Public endpoints
    const publicPaths = [
      "/auth/",
      "/health",
      "/brands",
      "/interests",
      "/values",
      "/intent-prompts",
      "/discovery-city-options",
      "/music/search",
      "/files/upload" // Some file endpoints might be public
    ];

    // Check if path matches any public path
    for (const publicPath of publicPaths) {
      if (path.includes(publicPath)) {
        return false;
      }
    }

    // Authenticated endpoints
    const authPaths = [
      "/me/",
      "/referrals/",
      "/discovery/",
      "/squad/",
      "/wallet/",
      "/friends/",
      "/payments/",
      "/streaming/",
      "/homepage"
    ];

    for (const authPath of authPaths) {
      if (path.startsWith(authPath)) {
        return true;
      }
    }

    // Default: require auth for /v1/* paths
    return path.startsWith("/v1/");
  }
}
