import { Injectable, HttpException, HttpStatus } from "@nestjs/common";
import fetch from "node-fetch";

export interface ModerationResult {
  safe: boolean;
  confidence: number;
  isHuman?: boolean;
  categories?: {
    adult?: number;
    racy?: number;
    violence?: number;
    aiGenerated?: number;
    peopleCount?: number;
    minor?: number;
  };
  failureReasons?: string[];
  error?: string;
}

const SIGHTENGINE_MODELS = "nudity-2.1,faces,people-counting,face-age,genai";

/** Explicit nudity thresholds — bikini / suggestive / raunchy allowed. */
const NUDITY_REJECT_THRESHOLD = 0.5;
/** AI-generated rejection threshold. */
const AI_GENERATED_THRESHOLD = 0.7;
/** Minor (under 18) rejection threshold. */
const MINOR_THRESHOLD = 0.5;

@Injectable()
export class ModerationService {
  private readonly apiUrl: string;
  private readonly apiUser: string;
  private readonly apiSecret: string;
  private readonly provider: "sightengine" | "google" | "aws" | "mock" | "none";
  private readonly enforceInProductionOnly: boolean;

  constructor() {
    const configuredProvider = (process.env.MODERATION_PROVIDER as any) || "mock";
    this.apiUrl = process.env.MODERATION_API_URL || "https://api.sightengine.com/1.0/check.json";
    this.apiUser = process.env.SIGHTENGINE_API_USER || process.env.MODERATION_API_USER || "";
    this.apiSecret =
      process.env.SIGHTENGINE_API_SECRET ||
      process.env.MODERATION_API_SECRET ||
      process.env.MODERATION_API_KEY ||
      "";
    this.enforceInProductionOnly =
      (process.env.MODERATION_PRODUCTION_ONLY ?? "true").toLowerCase() !== "false";

    // Production-only: skip real checks outside production unless explicitly disabled.
    if (this.enforceInProductionOnly && process.env.NODE_ENV !== "production") {
      this.provider = "none";
    } else {
      this.provider = configuredProvider;
    }
  }

  /**
   * Check if an image URL is appropriate for user photo uploads.
   * Rules:
   * 1. Must contain a person (no objects-only images)
   * 2. Must be a real photo (not AI-generated)
   * 3. No nudity (bikini / raunchy OK; topless / explicit not OK)
   * 4. Exactly one person
   * 5. No minors
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
        case "none":
          return this.checkDisabled();
        case "mock":
        default:
          return await this.checkWithMock(imageUrl);
      }
    } catch (error) {
      console.error("Moderation check failed:", error);
      throw new HttpException(
        "Image moderation check failed. Please try again.",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  /** No-op: image checks disabled (non-production or MODERATION_PROVIDER=none). */
  private checkDisabled(): ModerationResult {
    return {
      safe: true,
      confidence: 1,
      isHuman: true,
      categories: { adult: 0, racy: 0, violence: 0, aiGenerated: 0, peopleCount: 1, minor: 0 }
    };
  }

  private async checkWithMock(imageUrl: string): Promise<ModerationResult> {
    const unsafeKeywords = ["nsfw", "explicit", "adult", "xxx", "nude", "topless"];
    const nonHumanKeywords = ["object", "thing", "landscape", "animal", "car"];
    const aiKeywords = ["ai-generated", "midjourney", "stablediffusion"];
    const multiKeywords = ["group", "multiple-people", "crowd"];
    const minorKeywords = ["minor", "child", "kid"];
    const urlLower = imageUrl.toLowerCase();

    await new Promise((resolve) => setTimeout(resolve, 50));

    const failureReasons: string[] = [];
    const isHuman = !nonHumanKeywords.some((k) => urlLower.includes(k));
    if (!isHuman) {
      failureReasons.push("Photo must clearly show a person. Objects-only images are not allowed.");
    }
    if (aiKeywords.some((k) => urlLower.includes(k))) {
      failureReasons.push("AI-generated images are not allowed. Please upload a real photo.");
    }
    if (unsafeKeywords.some((k) => urlLower.includes(k))) {
      failureReasons.push("Nudity is not allowed. Swimwear and suggestive photos are fine.");
    }
    if (multiKeywords.some((k) => urlLower.includes(k))) {
      failureReasons.push("Only one person is allowed in the photo.");
    }
    if (minorKeywords.some((k) => urlLower.includes(k))) {
      failureReasons.push("Photos of minors are not allowed.");
    }

    if (failureReasons.length > 0) {
      return {
        safe: false,
        confidence: 0.9,
        isHuman,
        categories: { adult: 0.9, racy: 0.7 },
        failureReasons
      };
    }

    return {
      safe: true,
      confidence: 0.95,
      isHuman: true,
      categories: { adult: 0.1, racy: 0.1, aiGenerated: 0.1, peopleCount: 1, minor: 0.1 }
    };
  }

  /**
   * Sightengine API — models: nudity-2.1, faces, people-counting, face-age, genai
   * Docs: https://sightengine.com/docs/
   */
  private async checkWithSightengine(imageUrl: string): Promise<ModerationResult> {
    if (!this.apiUser || !this.apiSecret) {
      throw new Error("Sightengine credentials not configured (SIGHTENGINE_API_USER / SIGHTENGINE_API_SECRET)");
    }

    const params = new URLSearchParams({
      models: SIGHTENGINE_MODELS,
      api_user: this.apiUser,
      api_secret: this.apiSecret,
      url: imageUrl
    });

    const response = await fetch(`${this.apiUrl}?${params.toString()}`, {
      method: "GET",
      signal: AbortSignal.timeout(25000) as any
    });
    const data = (await response.json()) as any;

    if (data.status === "failure") {
      throw new Error(`Sightengine API error: ${data.error?.message || "Unknown error"}`);
    }

    return this.evaluateSightengineResult(data);
  }

  private evaluateSightengineResult(data: any): ModerationResult {
    const failureReasons: string[] = [];

    // --- People count (exactly 1) ---
    const peopleCountScores: Record<string, number> = data.people_count || {};
    const peopleCountLabel = this.argmaxScore(peopleCountScores) ?? null;
    const peopleCount =
      peopleCountLabel === "5+"
        ? 5
        : peopleCountLabel != null
          ? Number(peopleCountLabel)
          : (data.faces?.length ?? 0);

    const faces: any[] = Array.isArray(data.faces) ? data.faces : [];
    const isHuman = peopleCount >= 1 || faces.length >= 1;

    if (!isHuman || peopleCountLabel === "0" || (peopleCount === 0 && faces.length === 0)) {
      failureReasons.push("Photo must clearly show a person. Objects-only images are not allowed.");
    } else if (peopleCountLabel != null && peopleCountLabel !== "1") {
      failureReasons.push("Only one person is allowed in the photo.");
    } else if (peopleCountLabel == null && faces.length > 1) {
      failureReasons.push("Only one person is allowed in the photo.");
    }

    // --- Minors ---
    let maxMinor = 0;
    for (const face of faces) {
      const minor = Number(face?.attributes?.age?.minor ?? 0);
      if (minor > maxMinor) maxMinor = minor;
    }
    if (maxMinor >= MINOR_THRESHOLD) {
      failureReasons.push("Photos of minors are not allowed.");
    }

    // --- AI-generated ---
    const aiGenerated = Number(data.type?.ai_generated ?? 0);
    if (aiGenerated >= AI_GENERATED_THRESHOLD) {
      failureReasons.push("AI-generated images are not allowed. Please upload a real photo.");
    }

    // --- Nudity (allow bikini / suggestive; reject explicit / sexual display / erotica) ---
    const nudity = data.nudity || {};
    const sexualActivity = Number(nudity.sexual_activity ?? 0);
    const sexualDisplay = Number(nudity.sexual_display ?? 0);
    const erotica = Number(nudity.erotica ?? 0);
    const visiblyUndressed = Number(nudity.suggestive_classes?.visibly_undressed ?? 0);
    const adultScore = Math.max(sexualActivity, sexualDisplay, erotica, visiblyUndressed);
    // Keep suggestive scores for response metadata only — do not reject on them.
    const racyScore = Math.max(
      Number(nudity.very_suggestive ?? 0),
      Number(nudity.suggestive ?? 0),
      Number(nudity.mildly_suggestive ?? 0)
    );

    if (adultScore >= NUDITY_REJECT_THRESHOLD) {
      failureReasons.push("Nudity is not allowed. Swimwear and suggestive photos are fine.");
    }

    const unsafe = failureReasons.length > 0;
    const confidence = unsafe
      ? Math.max(adultScore, aiGenerated, maxMinor, peopleCount !== 1 ? 0.9 : 0)
      : 1 - Math.max(adultScore, aiGenerated, maxMinor);

    return {
      safe: !unsafe,
      confidence,
      isHuman,
      categories: {
        adult: adultScore,
        racy: racyScore,
        aiGenerated,
        peopleCount,
        minor: maxMinor
      },
      failureReasons: failureReasons.length > 0 ? failureReasons : undefined
    };
  }

  private argmaxScore(scores: Record<string, number>): string | null {
    const entries = Object.entries(scores);
    if (entries.length === 0) return null;
    let bestKey: string | null = null;
    let bestVal = -1;
    for (const [key, val] of entries) {
      const n = Number(val) || 0;
      if (n > bestVal) {
        bestVal = n;
        bestKey = key;
      }
    }
    return bestKey;
  }

  private async checkWithGoogleVision(imageUrl: string): Promise<ModerationResult> {
    const apiKey = process.env.MODERATION_API_KEY || "";
    if (!apiKey) {
      throw new Error("Google Vision API key not configured");
    }

    const url = `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            image: { source: { imageUri: imageUrl } },
            features: [{ type: "SAFE_SEARCH_DETECTION" }, { type: "FACE_DETECTION" }]
          }
        ]
      })
    });

    const data = (await response.json()) as any;
    if (data.error) {
      throw new Error(`Google Vision API error: ${data.error.message}`);
    }

    const annotation = data.responses?.[0];
    const safeSearch = annotation?.safeSearchAnnotation;
    if (!safeSearch) {
      throw new Error("No safe search annotation in response");
    }

    const faces = annotation?.faceAnnotations || [];
    const isHuman = faces.length > 0;
    const failureReasons: string[] = [];

    if (!isHuman) {
      failureReasons.push("Photo must clearly show a person. Objects-only images are not allowed.");
    } else if (faces.length > 1) {
      failureReasons.push("Only one person is allowed in the photo.");
    }

    const unsafeLevels = ["LIKELY", "VERY_LIKELY"];
    if (unsafeLevels.includes(safeSearch.adult)) {
      failureReasons.push("Nudity is not allowed. Swimwear and suggestive photos are fine.");
    }

    const levelToNumber = (level: string) => {
      const map: Record<string, number> = {
        VERY_UNLIKELY: 0.1,
        UNLIKELY: 0.3,
        POSSIBLE: 0.5,
        LIKELY: 0.8,
        VERY_LIKELY: 0.95
      };
      return map[level] || 0.5;
    };

    return {
      safe: failureReasons.length === 0,
      confidence: 0.9,
      isHuman,
      categories: {
        adult: levelToNumber(safeSearch.adult),
        racy: levelToNumber(safeSearch.racy),
        violence: levelToNumber(safeSearch.violence),
        peopleCount: faces.length
      },
      failureReasons: failureReasons.length > 0 ? failureReasons : undefined
    };
  }

  private async checkWithAWSRekognition(_imageUrl: string): Promise<ModerationResult> {
    throw new Error("AWS Rekognition implementation requires AWS SDK. Please configure AWS credentials.");
  }
}
