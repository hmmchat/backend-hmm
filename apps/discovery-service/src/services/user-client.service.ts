import { Injectable, HttpException, HttpStatus, OnModuleInit } from "@nestjs/common";
import fetch from "node-fetch";
import { verifyToken, AccessPayload } from "@hmm/common";
import { JWK } from "jose";

interface ActiveMeetingsResponse {
  count: number;
}

interface UserProfileResponse {
  id: string;
  username: string | null;
  dateOfBirth: string | null;
  gender: "MALE" | "FEMALE" | "NON_BINARY" | "PREFER_NOT_TO_SAY" | null;
  displayPictureUrl: string | null;
  preferredCity: string | null;
  intent: string | null;
  status: string;
  photos: Array<{ id: string; url: string; order: number }>;
  musicPreference: { id: string; name: string; artist: string; albumArtUrl: string | null } | null;
  brandPreferences: Array<{ brand: { id: string; name: string; logoUrl: string | null } }>;
  interests: Array<{ interest: { id: string; name: string; genre: string | null } }>;
  values: Array<{ value: { id: string; name: string } }>;
  videoEnabled: boolean;
  latitude?: number | null;
  longitude?: number | null;
  reportCount?: number;
}

export interface DiscoveryUser {
  id: string;
  username: string | null;
  dateOfBirth: string | null;
  gender: "MALE" | "FEMALE" | "NON_BINARY" | "PREFER_NOT_TO_SAY" | null;
  displayPictureUrl: string | null;
  preferredCity: string | null;
  intent: string | null;
  status: string;
  photos: Array<{ id: string; url: string; order: number }>;
  musicPreference: { id: string; name: string; artist: string; albumArtUrl: string | null } | null;
  brandPreferences: Array<{ brand: { id: string; name: string; logoUrl: string | null } }>;
  interests: Array<{ interest: { id: string; name: string; genre: string | null } }>;
  values: Array<{ value: { id: string; name: string } }>;
  videoEnabled: boolean;
  reportCount?: number;
}

interface DiscoveryUsersResponse {
  users: DiscoveryUser[];
}

@Injectable()
export class UserClientService implements OnModuleInit {
  private readonly userServiceUrl: string;
  private verifyAccess!: (token: string) => Promise<AccessPayload>;
  private publicJwk!: JWK;
  private readonly requestTimeoutMs: number;

  constructor() {
    this.userServiceUrl = process.env.USER_SERVICE_URL || "http://localhost:3002";
    this.requestTimeoutMs = parseInt(process.env.USER_SERVICE_TIMEOUT_MS || "5000", 10);
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
   * Fetch with timeout using AbortController
   */
  private async fetchWithTimeout(
    url: string,
    options: any,
    timeoutMs: number = this.requestTimeoutMs
  ): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      } as any);
      clearTimeout(timeoutId);
      return response;
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeoutMs}ms: ${url}`);
      }
      throw error;
    }
  }

  /**
   * Get count of users currently in calls or available to calls
   * Calls user-service to get the count
   */
  async getActiveMeetingsCount(): Promise<number> {
    try {
      const response = await this.fetchWithTimeout(
        `${this.userServiceUrl}/metrics/active-meetings`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" }
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`User service error: ${error}`);
      }

      const result = await response.json() as ActiveMeetingsResponse;
      return result.count;
    } catch (error: any) {
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
    return this.getUserProfileById(userId);
  }

  /**
   * Get user profile by user ID (test method, bypasses auth)
   * @param userId User ID
   */
  async getUserProfileById(userId: string): Promise<UserProfileResponse> {
    try {
      // Use /users/{id} endpoint without auth token (test mode)
      const response = await this.fetchWithTimeout(
        `${this.userServiceUrl}/users/${userId}?fields=gender`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json"
          }
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`User service error: ${error}`);
      }

      const result = await response.json() as { user: UserProfileResponse } | UserProfileResponse;
      if ('user' in result) {
        return result.user;
      }
      return result;
    } catch (error: any) {
      console.error("Failed to get user profile by ID from user-service:", error);
      throw new HttpException(
        "Unable to fetch user profile by ID. Please try again later.",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  /**
   * Get user full profile with all preferences for matching
   * @param token JWT access token
   */
  async getUserFullProfile(token: string): Promise<UserProfileResponse> {
    const userId = await this.getUserIdFromToken(token);
    
    try {
      const response = await this.fetchWithTimeout(
        `${this.userServiceUrl}/users/${userId}?fields=username,dateOfBirth,gender,displayPictureUrl,preferredCity,intent,status,photos,musicPreference,brandPreferences,interests,values,videoEnabled,latitude,longitude`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          }
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`User service error: ${error}`);
      }

      const result = await response.json() as { user: UserProfileResponse } | UserProfileResponse;
      if ('user' in result) {
        return result.user;
      }
      return result;
    } catch (error) {
      console.error("Failed to get user full profile from user-service:", error);
      throw new HttpException(
        "Unable to fetch user full profile. Please try again later.",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  /**
   * Get user full profile by user ID (test method, bypasses auth)
   * @param userId User ID
   */
  async getUserFullProfileById(userId: string): Promise<UserProfileResponse> {
    try {
      // Use test endpoint to bypass auth
      const response = await this.fetchWithTimeout(
        `${this.userServiceUrl}/users/test/${userId}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json"
          }
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`User service error: ${error}`);
      }

      const result = await response.json() as { user: UserProfileResponse } | UserProfileResponse;
      if ('user' in result) {
        return result.user;
      }
      return result;
    } catch (error: any) {
      console.error("Failed to get user full profile by ID from user-service:", error);
      throw new HttpException(
        "Unable to fetch user profile by ID. Please try again later.",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  /**
   * Get users for discovery matching
   * @param token JWT access token (for authentication, not used in query)
   * @param filters Discovery filters
   */
  async getUsersForDiscovery(
    token: string,
    filters: {
      city?: string | null;
      statuses: ("AVAILABLE" | "IN_SQUAD_AVAILABLE" | "IN_BROADCAST_AVAILABLE")[];
      genders?: ("MALE" | "FEMALE" | "NON_BINARY" | "PREFER_NOT_TO_SAY")[];
      excludeUserIds?: string[];
      limit?: number;
    }
  ): Promise<DiscoveryUser[]> {
    try {
      const response = await this.fetchWithTimeout(
        `${this.userServiceUrl}/users/discovery`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify(filters)
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`User service error: ${error}`);
      }

      const result = await response.json() as DiscoveryUsersResponse;
      return result.users || [];
    } catch (error) {
      console.error("Failed to get users for discovery from user-service:", error);
      throw new HttpException(
        "Unable to fetch users for discovery. Please try again later.",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  /**
   * Get users for discovery by user ID (test method, bypasses auth)
   * @param _userId User ID (not used in query, just for compatibility)
   * @param filters Discovery filters
   */
  async getUsersForDiscoveryById(
    _userId: string,
    filters: {
      city?: string | null;
      statuses: ("AVAILABLE" | "IN_SQUAD_AVAILABLE" | "IN_BROADCAST_AVAILABLE")[];
      genders?: ("MALE" | "FEMALE" | "NON_BINARY" | "PREFER_NOT_TO_SAY")[];
      excludeUserIds?: string[];
      limit?: number;
    }
  ): Promise<DiscoveryUser[]> {
    try {
      const response = await this.fetchWithTimeout(
        `${this.userServiceUrl}/users/discovery`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(filters)
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`User service error: ${error}`);
      }

      const result = await response.json() as DiscoveryUsersResponse;
      return result.users || [];
    } catch (error) {
      console.error("Failed to get users for discovery by ID from user-service:", error);
      throw new HttpException(
        "Unable to fetch users for discovery. Please try again later.",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  /**
   * Get preferred city for a user by user ID (test method, bypasses auth)
   * @param userId User ID
   */
  async getPreferredCityById(userId: string): Promise<string | null> {
    try {
      const response = await this.fetchWithTimeout(
        `${this.userServiceUrl}/users/${userId}?fields=preferredCity`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json"
          }
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`User service error: ${error}`);
      }

      const result = await response.json() as { user: UserProfileResponse } | UserProfileResponse;
      const user = 'user' in result ? result.user : result;
      return user.preferredCity || null;
    } catch (error) {
      console.error("Failed to get preferred city by ID from user-service:", error);
      return null; // Return null on error
    }
  }
}
