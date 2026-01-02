import { Injectable, HttpException, HttpStatus, OnModuleInit } from "@nestjs/common";
import fetch from "node-fetch";
import { verifyToken, AccessPayload } from "@hmm/common";
import { JWK } from "jose";

interface ActiveMeetingsResponse {
  count: number;
}

interface UserProfileResponse {
  id: string;
  gender: "MALE" | "FEMALE" | "NON_BINARY" | "PREFER_NOT_TO_SAY" | null;
  [key: string]: any;
}

@Injectable()
export class UserClientService implements OnModuleInit {
  private readonly userServiceUrl: string;
  private verifyAccess!: (token: string) => Promise<AccessPayload>;
  private publicJwk!: JWK;

  constructor() {
    this.userServiceUrl = process.env.USER_SERVICE_URL || "http://localhost:3002";
  }

  async onModuleInit() {
    const jwkStr = process.env.JWT_PUBLIC_JWK;
    if (!jwkStr || jwkStr === "undefined") {
      throw new Error("JWT_PUBLIC_JWK environment variable is not set or is invalid");
    }
    const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
    this.publicJwk = JSON.parse(cleanedJwk) as JWK;
    this.verifyAccess = await verifyToken(this.publicJwk);
  }

  private async getUserIdFromToken(token: string): Promise<string> {
    try {
      const payload = await this.verifyAccess(token);
      return payload.sub;
    } catch (error) {
      throw new HttpException("Invalid or expired token", HttpStatus.UNAUTHORIZED);
    }
  }

  /**
   * Get count of users currently in calls or available to calls
   * Calls user-service to get the count
   */
  async getActiveMeetingsCount(): Promise<number> {
    try {
      const response = await fetch(`${this.userServiceUrl}/metrics/active-meetings`, {
        method: "GET",
        headers: { "Content-Type": "application/json" }
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`User service error: ${error}`);
      }

      const result = await response.json() as ActiveMeetingsResponse;
      return result.count;
    } catch (error) {
      console.error("Failed to get active meetings count from user-service:", error);
      throw new HttpException(
        "Unable to fetch active meetings count. Please try again later.",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  /**
   * Get user profile with gender information
   * @param token JWT access token
   */
  async getUserProfile(token: string): Promise<UserProfileResponse> {
    // Extract user ID from token
    const userId = await this.getUserIdFromToken(token);
    
    try {
      // Use /users/{id} endpoint instead of /me as it's more reliable
      const response = await fetch(`${this.userServiceUrl}/users/${userId}?fields=gender`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`User service error: ${error}`);
      }

      const result = await response.json() as { user: UserProfileResponse } | UserProfileResponse;
      // Extract user from response (user-service returns { user: {...} })
      if ('user' in result) {
        return result.user;
      }
      return result;
    } catch (error) {
      console.error("Failed to get user profile from user-service:", error);
      throw new HttpException(
        "Unable to fetch user profile. Please try again later.",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }
}

