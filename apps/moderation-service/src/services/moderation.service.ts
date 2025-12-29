import { Injectable, HttpException, HttpStatus } from "@nestjs/common";
import fetch from "node-fetch";

export interface ModerationResult {
  safe: boolean;
  confidence: number;
  categories?: {
    adult?: number;
    racy?: number;
    violence?: number;
    medical?: number;
  };
  error?: string;
}

@Injectable()
export class ModerationService {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly provider: "sightengine" | "google" | "aws" | "mock";

  constructor() {
    this.provider = (process.env.MODERATION_PROVIDER as any) || "mock";
    this.apiUrl = process.env.MODERATION_API_URL || "";
    this.apiKey = process.env.MODERATION_API_KEY || "";

    // For production, you'd use:
    // - Sightengine: https://api.sightengine.com/1.0/check.json
    // - Google Vision: https://vision.googleapis.com/v1/images:annotate
    // - AWS Rekognition: Use AWS SDK
  }

  /**
   * Check if an image URL is safe for work (NSFW check)
   * 
   * @param imageUrl - URL of the image to check
   * @returns ModerationResult with safe/unsafe status
   */
  async checkImage(imageUrl: string): Promise<ModerationResult> {
    try {
      switch (this.provider) {
        case "sightengine":
          return await this.checkWithSightengine(imageUrl);
        case "google":
          return await this.checkWithGoogleVision(imageUrl);
        case "aws":
          return await this.checkWithAWSRekognition(imageUrl);
        case "mock":
        default:
          return await this.checkWithMock(imageUrl);
      }
    } catch (error) {
      console.error("Moderation check failed:", error);
      // In production, you might want to fail closed (reject) or fail open (allow)
      // For now, we'll fail closed (reject) if moderation service fails
      throw new HttpException(
        "Image moderation check failed. Please try again.",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  /**
   * Mock implementation for development/testing
   * In production, replace with actual moderation API
   */
  private async checkWithMock(imageUrl: string): Promise<ModerationResult> {
    // Mock: Check if URL contains certain keywords (for testing)
    const unsafeKeywords = ["nsfw", "explicit", "adult", "xxx"];
    const urlLower = imageUrl.toLowerCase();
    const hasUnsafeKeyword = unsafeKeywords.some(keyword => urlLower.includes(keyword));

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 100));

    if (hasUnsafeKeyword) {
      return {
        safe: false,
        confidence: 0.9,
        categories: {
          adult: 0.9,
          racy: 0.7
        }
      };
    }

    return {
      safe: true,
      confidence: 0.95,
      categories: {
        adult: 0.1,
        racy: 0.1
      }
    };
  }

  /**
   * Sightengine API implementation
   * Documentation: https://sightengine.com/docs/image-moderation
   */
  private async checkWithSightengine(imageUrl: string): Promise<ModerationResult> {
    if (!this.apiKey) {
      throw new Error("Sightengine API key not configured");
    }

    const url = `${this.apiUrl}?api_user=${this.apiKey}&models=nudity,wad,offensive,celebrities,scam&url=${encodeURIComponent(imageUrl)}`;

    const response = await fetch(url);
    const data = await response.json() as any;

    if (data.status === "failure") {
      throw new Error(`Sightengine API error: ${data.error?.message || "Unknown error"}`);
    }

    const nudity = data.nudity?.sexual_activity || 0;
    const racy = data.racy || 0;
    const offensive = data.offensive?.prob || 0;

    // Consider unsafe if nudity > 0.5 or racy > 0.7 or offensive > 0.7
    const unsafe = nudity > 0.5 || racy > 0.7 || offensive > 0.7;

    return {
      safe: !unsafe,
      confidence: unsafe ? Math.max(nudity, racy, offensive) : 1 - Math.max(nudity, racy, offensive),
      categories: {
        adult: nudity,
        racy: racy,
        violence: offensive
      }
    };
  }

  /**
   * Google Vision API implementation
   * Documentation: https://cloud.google.com/vision/docs/safesearch-detection
   */
  private async checkWithGoogleVision(imageUrl: string): Promise<ModerationResult> {
    if (!this.apiKey) {
      throw new Error("Google Vision API key not configured");
    }

    const url = `https://vision.googleapis.com/v1/images:annotate?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [{
          image: { source: { imageUri: imageUrl } },
          features: [{ type: "SAFE_SEARCH_DETECTION" }]
        }]
      })
    });

    const data = await response.json() as any;

    if (data.error) {
      throw new Error(`Google Vision API error: ${data.error.message}`);
    }

    const safeSearch = data.responses[0]?.safeSearchAnnotation;
    if (!safeSearch) {
      throw new Error("No safe search annotation in response");
    }

    // Google Vision returns: VERY_UNLIKELY, UNLIKELY, POSSIBLE, LIKELY, VERY_LIKELY
    const adultLevel = safeSearch.adult;
    const racyLevel = safeSearch.racy;
    const violenceLevel = safeSearch.violence;

    const unsafeLevels = ["LIKELY", "VERY_LIKELY"];
    const unsafe = unsafeLevels.includes(adultLevel) || 
                   unsafeLevels.includes(racyLevel) || 
                   unsafeLevels.includes(violenceLevel);

    // Convert to numeric confidence
    const levelToNumber = (level: string) => {
      const map: Record<string, number> = {
        "VERY_UNLIKELY": 0.1,
        "UNLIKELY": 0.3,
        "POSSIBLE": 0.5,
        "LIKELY": 0.8,
        "VERY_LIKELY": 0.95
      };
      return map[level] || 0.5;
    };

    return {
      safe: !unsafe,
      confidence: unsafe ? Math.max(
        levelToNumber(adultLevel),
        levelToNumber(racyLevel),
        levelToNumber(violenceLevel)
      ) : 0.9,
      categories: {
        adult: levelToNumber(adultLevel),
        racy: levelToNumber(racyLevel),
        violence: levelToNumber(violenceLevel)
      }
    };
  }

  /**
   * AWS Rekognition implementation
   * Documentation: https://docs.aws.amazon.com/rekognition/latest/dg/moderation.html
   */
  private async checkWithAWSRekognition(_imageUrl: string): Promise<ModerationResult> {
    // This would require AWS SDK
    // const { RekognitionClient, DetectModerationLabelsCommand } = require("@aws-sdk/client-rekognition");
    
    // For now, return a placeholder
    throw new Error("AWS Rekognition implementation requires AWS SDK. Please configure AWS credentials.");
  }
}

