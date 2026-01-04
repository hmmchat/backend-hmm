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

interface DiscoveryUser {
  id: string;
  username: string | null;
  dateOfBirth: Date | null;
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
}

interface DiscoveryUsersResponse {
  users: DiscoveryUser[];
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
    return this.getUserProfileById(userId);
  }

  /**
   * Get user profile by user ID (test method, bypasses auth)
   * @param userId User ID
   */
  async getUserProfileById(userId: string): Promise<UserProfileResponse> {
    try {
      // Use /users/{id} endpoint without auth token (test mode)
      const response = await fetch(`${this.userServiceUrl}/users/${userId}?fields=gender`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json"
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
      console.error("Failed to get user profile by ID from user-service:", error);
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
      const response = await fetch(`${this.userServiceUrl}/users/discovery`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(filters)
      });

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
   * Get user full profile with all preferences for matching
   * @param token JWT access token
   */
  async getUserFullProfile(token: string): Promise<UserProfileResponse> {
    const userId = await this.getUserIdFromToken(token);
    
    try {
      const response = await fetch(
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
        "Unable to fetch user profile. Please try again later.",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  /**
   * Get user full profile by ID (test mode - bypasses auth)
   */
  async getUserFullProfileById(userId: string): Promise<UserProfileResponse> {
    try {
      const response = await fetch(
        `${this.userServiceUrl}/users/${userId}?fields=username,dateOfBirth,gender,displayPictureUrl,preferredCity,intent,status,photos,musicPreference,brandPreferences,interests,values,videoEnabled,latitude,longitude`,
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
    } catch (error) {
      console.error("Failed to get user full profile from user-service:", error);
      throw new HttpException(
        "Unable to fetch user profile. Please try again later.",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  /**
   * Get preferred city by user ID (test mode - bypasses auth)
   */
  async getPreferredCityById(userId: string): Promise<string | null> {
    try {
      const response = await fetch(
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

      const result = await response.json() as { user: { preferredCity: string | null } };
      return result.user.preferredCity || null;
    } catch (error) {
      console.error("Failed to get preferred city:", error);
      throw new HttpException(
        "Unable to fetch preferred city. Please try again later.",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  /**
   * Get users for discovery by user ID (test mode - bypasses auth)
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
      const response = await fetch(`${this.userServiceUrl}/users/discovery`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(filters)
      });

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
}

