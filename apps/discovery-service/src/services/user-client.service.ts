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
  isModerator?: boolean;
  kycStatus?: "UNVERIFIED" | "VERIFIED" | "PENDING_REVIEW" | "REVOKED" | "EXPIRED";
  kycRiskScore?: number;
  kycExpiresAt?: string | null;
  reportModeratorCardsOnly?: boolean;
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
  isModerator?: boolean;
  kycStatus?: "UNVERIFIED" | "VERIFIED" | "PENDING_REVIEW" | "REVOKED" | "EXPIRED";
  kycRiskScore?: number;
  kycExpiresAt?: string | null;
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
        `${this.userServiceUrl}/users/${userId}?fields=gender,isModerator,kycStatus,kycRiskScore,kycExpiresAt,reportCount,reportModeratorCardsOnly`,
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
        `${this.userServiceUrl}/users/${userId}?fields=username,dateOfBirth,gender,displayPictureUrl,preferredCity,intent,status,photos,musicPreference,brandPreferences,interests,values,videoEnabled,latitude,longitude,reportCount,isModerator,kycStatus,kycRiskScore,kycExpiresAt,reportModeratorCardsOnly`,
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
        const errorText = await response.text();
        let errorData: any;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { message: errorText };
        }
        
        // If user not found (404), throw NOT_FOUND instead of SERVICE_UNAVAILABLE
        if (response.status === 404 || errorData.statusCode === 404 || errorData.message?.includes('not found')) {
          throw new HttpException(
            {
              message: `User profile not found for userId: ${userId}`,
              error: errorData.message || 'User not found',
              code: 'USER_NOT_FOUND',
              suggestion: `Please create the user profile first using the Setup tab in the test interface, or use POST /users/${userId}/profile`
            },
            HttpStatus.NOT_FOUND
          );
        }
        
        // For other errors, include the actual error details
        throw new Error(`User service error (${response.status}): ${errorText}`);
      }

      const result = await response.json() as { user: UserProfileResponse } | UserProfileResponse;
      if ('user' in result) {
        return result.user;
      }
      return result;
    } catch (error: any) {
      // If it's already an HttpException (like NOT_FOUND), re-throw it
      if (error instanceof HttpException) {
        throw error;
      }
      
      console.error("Failed to get user full profile by ID from user-service:", error);
      
      // Check if it's a timeout error
      if (error.message?.includes('timeout') || error.message?.includes('Request timeout')) {
        throw new HttpException(
          {
            message: `Request to user-service timed out after ${this.requestTimeoutMs}ms`,
            error: error.message,
            code: 'USER_SERVICE_TIMEOUT',
            suggestion: 'Check if user-service is running and accessible. Try increasing USER_SERVICE_TIMEOUT_MS if needed.'
          },
          HttpStatus.SERVICE_UNAVAILABLE
        );
      }
      
      // Check if it's a connection error
      if (error.message?.includes('ECONNREFUSED') || error.message?.includes('fetch failed')) {
        throw new HttpException(
          {
            message: 'Unable to connect to user-service',
            error: error.message,
            code: 'USER_SERVICE_CONNECTION_ERROR',
            suggestion: `Check if user-service is running at ${this.userServiceUrl}`
          },
          HttpStatus.SERVICE_UNAVAILABLE
        );
      }
      
      throw new HttpException(
        {
          message: "Unable to fetch user profile by ID. Please try again later.",
          error: error.message || 'Unknown error',
          code: 'USER_SERVICE_ERROR',
          details: error,
          suggestion: `Check: 1) User exists in database, 2) User-service is running at ${this.userServiceUrl}, 3) Check user-service logs for details`
        },
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
      statuses: ("AVAILABLE" | "IN_SQUAD_AVAILABLE" | "IN_BROADCAST_AVAILABLE" | "ONLINE" | "OFFLINE" | "VIEWER" | "MATCHED")[];
      genders?: ("MALE" | "FEMALE" | "NON_BINARY" | "PREFER_NOT_TO_SAY")[];
      excludeUserIds?: string[];
      includeModerators?: boolean;
      excludeModerators?: boolean;
      onlyModerators?: boolean;
      excludeKycStatuses?: ("UNVERIFIED" | "VERIFIED" | "PENDING_REVIEW" | "REVOKED" | "EXPIRED")[];
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
      statuses: ("AVAILABLE" | "IN_SQUAD_AVAILABLE" | "IN_BROADCAST_AVAILABLE" | "ONLINE" | "OFFLINE" | "VIEWER" | "MATCHED")[];
      genders?: ("MALE" | "FEMALE" | "NON_BINARY" | "PREFER_NOT_TO_SAY")[];
      excludeUserIds?: string[];
      includeModerators?: boolean;
      excludeModerators?: boolean;
      onlyModerators?: boolean;
      excludeKycStatuses?: ("UNVERIFIED" | "VERIFIED" | "PENDING_REVIEW" | "REVOKED" | "EXPIRED")[];
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
