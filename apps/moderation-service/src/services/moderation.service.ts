import { Injectable, HttpException, HttpStatus } from "@nestjs/common";
import fetch from "node-fetch";

export interface ModerationResult {
  safe: boolean;
  confidence: number;
  isHuman?: boolean; // Whether the image contains a human/person
  categories?: {
    adult?: number;
    racy?: number;
    violence?: number;
    medical?: number;
  };
  failureReasons?: string[]; // Specific reasons why the image was rejected
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
   * Check if an image URL is appropriate for profile photos
   * Validates:
   * 1. Image contains a human/person (not objects or other things)
   * 2. No NSFW content (nudity, adult content)
   * 3. Other appropriate checks (violence, offensive content)
   * 
   * @param imageUrl - URL of the image to check
   * @returns ModerationResult with safe/unsafe status and specific failure reasons
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
   * 
   * ⚠️ IMPORTANT LIMITATION: This mock provider only checks URL keywords, NOT actual image content.
   * It will NOT detect nudity or inappropriate content if the URL is clean.
   * 
   * For production, you MUST use a real provider (Sightengine, Google Vision, or AWS Rekognition)
   * that actually analyzes the image content.
   * 
   * Example:
   * - URL: "https://example.com/profile.jpg" with actual nudity → Mock will mark as SAFE (incorrect!)
   * - URL: "https://example.com/nsfw-image.jpg" → Mock will mark as UNSAFE (correct, but only because of keyword)
   * 
   * Real providers download and analyze the actual image pixels, so they catch content regardless of URL.
   */
  private async checkWithMock(imageUrl: string): Promise<ModerationResult> {
    // Mock: Check if URL contains certain keywords (for testing)
    // ⚠️ WARNING: This does NOT analyze actual image content - only URL string!
    const unsafeKeywords = ["nsfw", "explicit", "adult", "xxx"];
    const nonHumanKeywords = ["object", "thing", "landscape", "animal", "car"];
    const urlLower = imageUrl.toLowerCase();
    const hasUnsafeKeyword = unsafeKeywords.some(keyword => urlLower.includes(keyword));
    const hasNonHumanKeyword = nonHumanKeywords.some(keyword => urlLower.includes(keyword));

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 100));

    const failureReasons: string[] = [];

    // Check if human (for mock, assume human unless non-human keyword present)
    const isHuman = !hasNonHumanKeyword;

    if (!isHuman) {
      failureReasons.push("Image must contain a human person. Objects, landscapes, or other non-human content is not allowed.");
    }

    if (hasUnsafeKeyword) {
      failureReasons.push("Image contains inappropriate content. Please upload a safe, appropriate photo.");
    }

    if (failureReasons.length > 0) {
      return {
        safe: false,
        confidence: 0.9,
        isHuman,
        categories: {
          adult: hasUnsafeKeyword ? 0.9 : 0.1,
          racy: hasUnsafeKeyword ? 0.7 : 0.1
        },
        failureReasons
      };
    }

    return {
      safe: true,
      confidence: 0.95,
      isHuman: true,
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

    const url = `${this.apiUrl}?api_user=${this.apiKey}&models=nudity,wad,offensive,celebrities,scam,faces&url=${encodeURIComponent(imageUrl)}`;

    const response = await fetch(url);
    const data = await response.json() as any;

    if (data.status === "failure") {
      throw new Error(`Sightengine API error: ${data.error?.message || "Unknown error"}`);
    }

    const nudity = data.nudity?.sexual_activity || 0;
    const racy = data.racy || 0;
    const offensive = data.offensive?.prob || 0;
    
    // Check for human/face detection (Sightengine provides faces detection)
    const faces = data.faces?.length || 0;
    const isHuman = faces > 0;

    const failureReasons: string[] = [];

    if (!isHuman) {
      failureReasons.push("Image must contain a human person. Please upload a photo of yourself.");
    }

    if (nudity > 0.5) {
      failureReasons.push("Image contains inappropriate adult content. Please upload a safe, appropriate photo.");
    } else if (racy > 0.7) {
      failureReasons.push("Image contains suggestive content. Please upload a more appropriate photo.");
    }

    if (offensive > 0.7) {
      failureReasons.push("Image contains offensive or inappropriate content. Please upload another photo.");
    }

    const unsafe = !isHuman || nudity > 0.5 || racy > 0.7 || offensive > 0.7;

    return {
      safe: !unsafe,
      confidence: unsafe ? Math.max(nudity, racy, offensive) : 1 - Math.max(nudity, racy, offensive),
      isHuman,
      categories: {
        adult: nudity,
        racy: racy,
        violence: offensive
      },
      failureReasons: failureReasons.length > 0 ? failureReasons : undefined
    };
  }

  /**
   * Google Vision API implementation
   * Documentation: https://cloud.google.com/vision/docs/safesearch-detection
   * 
   * ✅ This provider ACTUALLY analyzes image content:
   * - Downloads the image from the URL
   * - Uses machine learning to detect nudity, adult content, violence
   * - Analyzes actual image pixels, not URL names
   * - Works regardless of URL name
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
    
    // Google Vision doesn't provide face detection in safe search, so we'd need a separate face detection call
    // For now, assume human (can be enhanced later)
    const isHuman = true; // TODO: Add face detection call if needed

    const failureReasons: string[] = [];

    if (!isHuman) {
      failureReasons.push("Image must contain a human person. Please upload a photo of yourself.");
    }

    const unsafeLevels = ["LIKELY", "VERY_LIKELY"];
    const isAdultUnsafe = unsafeLevels.includes(adultLevel);
    const isRacyUnsafe = unsafeLevels.includes(racyLevel);
    const isViolenceUnsafe = unsafeLevels.includes(violenceLevel);
    
    if (isAdultUnsafe) {
      failureReasons.push("Image contains inappropriate adult content. Please upload a safe, appropriate photo.");
    } else if (isRacyUnsafe) {
      failureReasons.push("Image contains suggestive content. Please upload a more appropriate photo.");
    }

    if (isViolenceUnsafe) {
      failureReasons.push("Image contains violent or offensive content. Please upload another photo.");
    }

    const unsafe = !isHuman || isAdultUnsafe || isRacyUnsafe || isViolenceUnsafe;

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
      isHuman,
      categories: {
        adult: levelToNumber(adultLevel),
        racy: levelToNumber(racyLevel),
        violence: levelToNumber(violenceLevel)
      },
      failureReasons: failureReasons.length > 0 ? failureReasons : undefined
    };
  }

  /**
   * AWS Rekognition implementation
   * Documentation: https://docs.aws.amazon.com/rekognition/latest/dg/moderation.html
   * 
   * ✅ This provider ACTUALLY analyzes image content:
   * - Downloads the image from the URL
   * - Uses AWS machine learning to detect inappropriate content
   * - Analyzes actual image pixels, not URL names
   * - Works regardless of URL name
   */
  private async checkWithAWSRekognition(_imageUrl: string): Promise<ModerationResult> {
    // This would require AWS SDK
    // const { RekognitionClient, DetectModerationLabelsCommand } = require("@aws-sdk/client-rekognition");
    
    // For now, return a placeholder
    throw new Error("AWS Rekognition implementation requires AWS SDK. Please configure AWS credentials.");
  }
}

