import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import fetch from "node-fetch";
import { verifyToken } from "@hmm/common";

@Injectable()
export class AggregationService {
  private readonly logger = new Logger(AggregationService.name);
  private readonly walletServiceUrl: string;
  private readonly discoveryServiceUrl: string;
  private readonly userServiceUrl: string;
  private publicJwk: any = null;

  constructor(private configService: ConfigService) {
    this.walletServiceUrl = this.configService.get<string>("WALLET_SERVICE_URL") || "http://localhost:3005";
    this.discoveryServiceUrl = this.configService.get<string>("DISCOVERY_SERVICE_URL") || "http://localhost:3004";
    this.userServiceUrl = this.configService.get<string>("USER_SERVICE_URL") || "http://localhost:3002";

    // Load JWT public key
    const jwkStr = this.configService.get<string>("JWT_PUBLIC_JWK");
    if (jwkStr && jwkStr !== "undefined") {
      try {
        const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
        this.publicJwk = JSON.parse(cleanedJwk);
      } catch (error) {
        this.logger.warn("Failed to parse JWT_PUBLIC_JWK");
      }
    }
  }

  /**
   * Get homepage aggregated data
   */
  async getHomepage(token: string): Promise<any> {
    // Verify token is valid (getUserIdFromToken will throw if invalid)
    await this.getUserIdFromToken(token);

    // Fetch data from multiple services in parallel
    const [coinsData, meetingCount, profileCompletion] = await Promise.allSettled([
      this.getCoins(token),
      this.getMeetingCount(token),
      this.getProfileCompletion(token)
    ]);

    return {
      coins: coinsData.status === "fulfilled" ? coinsData.value.coins : 0,
      diamonds: coinsData.status === "fulfilled" ? coinsData.value.diamonds : 0,
      meetingCount: meetingCount.status === "fulfilled" ? meetingCount.value : 0,
      profileCompletion: profileCompletion.status === "fulfilled" ? profileCompletion.value : null
    };
  }

  /**
   * Get user ID from token
   */
  private async getUserIdFromToken(token: string): Promise<string> {
    if (!this.publicJwk) {
      throw new HttpException("JWT configuration error", HttpStatus.INTERNAL_SERVER_ERROR);
    }

    try {
      const verifyAccess = await verifyToken(this.publicJwk);
      const payload = await verifyAccess(token);
      return payload.sub;
    } catch (error: any) {
      throw new HttpException("Invalid token", HttpStatus.UNAUTHORIZED);
    }
  }

  /**
   * Get coins balance from wallet service
   */
  private async getCoins(token: string): Promise<{ coins: number; diamonds: number }> {
    try {
      const response = await fetch(`${this.walletServiceUrl}/me/balance`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      });

      if (!response.ok) {
        throw new Error(`Wallet service returned ${response.status}`);
      }

      const data = await response.json() as any;
      return {
        coins: data.coins || 0,
        diamonds: data.diamonds || 0
      };
    } catch (error: any) {
      this.logger.warn(`Failed to fetch coins: ${error.message}`);
      return { coins: 0, diamonds: 0 };
    }
  }

  /**
   * Get meeting count from discovery service
   */
  private async getMeetingCount(token: string): Promise<number> {
    try {
      // Try metrics endpoint first
      const response = await fetch(`${this.discoveryServiceUrl}/metrics/meetings`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      });

      if (!response.ok) {
        // Try alternative endpoint format
        const altResponse = await fetch(`${this.discoveryServiceUrl}/metrics/active-meetings`, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
          }
        });

        if (!altResponse.ok) {
          return 0;
        }

        const altData = await altResponse.json() as any;
        return altData.count || altData.liveMeetings || 0;
      }

      const data = await response.json() as any;
      return data.count || data.liveMeetings || 0;
    } catch (error: any) {
      this.logger.warn(`Failed to fetch meeting count: ${error.message}`);
      return 0;
    }
  }

  /**
   * Get profile completion from user service
   */
  private async getProfileCompletion(token: string): Promise<any> {
    try {
      const response = await fetch(`${this.userServiceUrl}/me/profile-completion`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      });

      if (!response.ok) {
        return null;
      }

      return await response.json() as any;
    } catch (error: any) {
      this.logger.warn(`Failed to fetch profile completion: ${error.message}`);
      return null;
    }
  }
}
