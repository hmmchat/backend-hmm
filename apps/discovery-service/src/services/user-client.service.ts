import { Injectable, HttpException, HttpStatus } from "@nestjs/common";
import fetch from "node-fetch";

interface ActiveMeetingsResponse {
  count: number;
}

@Injectable()
export class UserClientService {
  private readonly userServiceUrl: string;

  constructor() {
    this.userServiceUrl = process.env.USER_SERVICE_URL || "http://localhost:3002";
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
}

