import { Injectable, HttpException, HttpStatus } from "@nestjs/common";
import fetch from "node-fetch";

interface ModerationResult {
  safe: boolean;
  confidence: number;
  categories?: {
    adult?: number;
    racy?: number;
    violence?: number;
  };
}

@Injectable()
export class ModerationClientService {
  private readonly moderationServiceUrl: string;

  constructor() {
    this.moderationServiceUrl = process.env.MODERATION_SERVICE_URL || "http://localhost:3003";
  }

  /**
   * Check if an image is safe for work (NSFW check)
   * Calls the moderation-service to validate the image
   */
  async checkImage(imageUrl: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.moderationServiceUrl}/moderation/check-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Moderation service error: ${error}`);
      }

      const result = await response.json() as ModerationResult;

      if (!result.safe) {
        throw new HttpException(
          "Image failed moderation check. Please upload a safe for work image.",
          HttpStatus.BAD_REQUEST
        );
      }

      return true;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      // If moderation service is unavailable, you can choose to:
      // 1. Fail closed (reject) - safer but might block legitimate users
      // 2. Fail open (allow) - less safe but better UX
      // For now, we'll fail closed
      console.error("Moderation check failed:", error);
      throw new HttpException(
        "Unable to verify image content. Please try again later.",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }
}

