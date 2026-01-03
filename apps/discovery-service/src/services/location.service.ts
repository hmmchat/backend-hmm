import { Injectable, HttpException, HttpStatus, OnModuleInit } from "@nestjs/common";
import fetch from "node-fetch";
import { AccessPayload } from "@hmm/common";
import { JWK } from "jose";

interface CityWithUserCount {
  city: string;
  availableCount: number;
}

interface GeocodingResult {
  city: string;
  country?: string;
  state?: string;
}

interface NominatimResponse {
  address?: {
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    state?: string;
    country?: string;
  };
  display_name?: string;
}

@Injectable()
export class LocationService implements OnModuleInit {
  private readonly userServiceUrl: string;
  private verifyAccess!: (token: string) => Promise<AccessPayload>;
  private publicJwk!: JWK;
  private readonly geocodingApiUrl: string;

  constructor() {
    this.userServiceUrl = process.env.USER_SERVICE_URL || "http://localhost:3002";
    // Use OpenStreetMap Nominatim API (free, no API key required)
    // Can be overridden with environment variable for other services
    // Note: Nominatim requires a User-Agent header (set in fetch calls)
    this.geocodingApiUrl = process.env.GEOCODING_API_URL || "https://nominatim.openstreetmap.org";
  }

  async onModuleInit() {
    const jwkStr = process.env.JWT_PUBLIC_JWK;
    if (!jwkStr || jwkStr === "undefined") {
      throw new Error("JWT_PUBLIC_JWK environment variable is not set or is invalid");
    }
    const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
    this.publicJwk = JSON.parse(cleanedJwk) as JWK;
    const { verifyToken } = await import("@hmm/common");
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
   * Get list of cities with maximum users
   * Returns cities sorted by user count (descending)
   */
  async getCitiesWithMaxUsers(limit: number = 20): Promise<CityWithUserCount[]> {
    try {
      // Call user-service to get cities with max users
      const response = await fetch(`${this.userServiceUrl}/metrics/cities?limit=${limit}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" }
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`User service error: ${error}`);
      }

      const result = await response.json() as CityWithUserCount[];
      return result || [];
    } catch (error) {
      console.error("Failed to get cities with max users:", error);
      throw new HttpException(
        "Unable to fetch cities. Please try again later.",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  /**
   * Search for cities by name
   * Uses OpenStreetMap Nominatim API for city search
   */
  async searchCities(query: string, limit: number = 20): Promise<Array<{ city: string; country?: string; state?: string }>> {
    try {
      // Use Nominatim API for city search
      const url = `${this.geocodingApiUrl}/search?q=${encodeURIComponent(query)}&format=json&limit=${limit}&addressdetails=1&featuretype=city`;
      
      const response = await fetch(url, {
        headers: {
          "User-Agent": "HMM-Chat-Backend/1.0" // Required by Nominatim
        }
      });

      if (!response.ok) {
        throw new Error(`Geocoding API error: ${response.statusText}`);
      }

      const results = await response.json() as NominatimResponse[];

      // Extract city names from results
      const cities: Array<{ city: string; country?: string; state?: string }> = [];
      for (const result of results) {
        const addr = result.address;
        const city = addr?.city || addr?.town || addr?.village || addr?.municipality;
        if (city) {
          cities.push({
            city,
            country: addr?.country,
            state: addr?.state
          });
        }
      }

      // Remove duplicates based on city name
      const uniqueCities: Array<{ city: string; country?: string; state?: string }> = Array.from(
        new Map(cities.map((c) => [c.city.toLowerCase(), c])).values()
      );

      return uniqueCities.slice(0, limit);
    } catch (error) {
      console.error("Failed to search cities:", error);
      throw new HttpException(
        "Unable to search cities. Please try again later.",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  /**
   * Get city name from latitude and longitude (reverse geocoding)
   * Uses OpenStreetMap Nominatim API
   */
  async locateMe(latitude: number, longitude: number): Promise<GeocodingResult> {
    try {
      // Use Nominatim API for reverse geocoding
      const url = `${this.geocodingApiUrl}/reverse?lat=${latitude}&lon=${longitude}&format=json&addressdetails=1`;
      
      const response = await fetch(url, {
        headers: {
          "User-Agent": "HMM-Chat-Backend/1.0" // Required by Nominatim
        }
      });

      if (!response.ok) {
        throw new Error(`Geocoding API error: ${response.statusText}`);
      }

      const result = await response.json() as NominatimResponse;

      const addr = result.address;
      const city = addr?.city || addr?.town || addr?.village || addr?.municipality;
      
      if (!city) {
        throw new HttpException(
          "Could not determine city from location. Please try again or select a city manually.",
          HttpStatus.BAD_REQUEST
        );
      }

      return {
        city,
        country: addr?.country,
        state: addr?.state
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      console.error("Failed to locate city:", error);
      throw new HttpException(
        "Unable to determine city from location. Please try again later.",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  /**
   * Update user's preferred city
   */
  async updatePreferredCity(token: string, city: string | null): Promise<{ city: string | null }> {
    await this.getUserIdFromToken(token); // Verify token is valid

    try {
      // Call user-service to update preferred city
      const response = await fetch(`${this.userServiceUrl}/me/preferred-city`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ city })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`User service error: ${error}`);
      }

      const result = await response.json() as { city: string | null };
      return result;
    } catch (error) {
      console.error("Failed to update preferred city:", error);
      throw new HttpException(
        "Unable to update preferred city. Please try again later.",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  /**
   * Get user's current preferred city
   */
  async getPreferredCity(token: string): Promise<{ city: string | null }> {
    const userId = await this.getUserIdFromToken(token);

    try {
      // Call user-service to get preferred city
      const response = await fetch(`${this.userServiceUrl}/users/${userId}?fields=preferredCity`, {
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

      const result = await response.json() as { user: { preferredCity: string | null } };
      return { city: result.user.preferredCity || null };
    } catch (error) {
      console.error("Failed to get preferred city:", error);
      throw new HttpException(
        "Unable to fetch preferred city. Please try again later.",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }
}

