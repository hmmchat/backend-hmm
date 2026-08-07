import { Injectable, HttpException, HttpStatus } from "@nestjs/common";
import fetch from "node-fetch";

export type ModerationPurpose = "display" | "gallery";

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

/**
 * DP: a face counts as a co-subject only if it is large enough relative to the
 * main face. Tiny / background / out-of-focus faces are ignored.
 */
const PROMINENT_FACE_RELATIVE_AREA = 0.4;
/** Absolute area floor (normalized 0–1 box) so tiny detections never count. */
const PROMINENT_FACE_MIN_AREA = 0.02;

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
   *
   * Shared rules (both purposes):
   * 1. Must be a real photo (not AI-generated)
   * 2. No nudity (bikini / raunchy OK; topless / explicit not OK)
   * 3. No minors
   *
   * purpose=display (DP / slot 1):
   * 4. Must clearly show a person as the main subject
   * 5. Reject only when 2+ people are co-equal subjects (background / blur OK)
   *
   * purpose=gallery (slots 2–3):
   * 4. Group photos and object / non-person images are allowed
   */
  async checkImage(
    imageUrl: string,
    purpose: ModerationPurpose = "display"
  ): Promise<ModerationResult> {
    try {
      switch (this.provider) {
        case "sightengine":
          return await this.checkWithSightengine(imageUrl, purpose);
        case "google":
          return await this.checkWithGoogleVision(imageUrl, purpose);
        case "aws":
          return await this.checkWithAWSRekognition(imageUrl);
        case "none":
          return this.checkDisabled();
        case "mock":
        default:
          return await this.checkWithMock(imageUrl, purpose);
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

  private async checkWithMock(
    imageUrl: string,
    purpose: ModerationPurpose
  ): Promise<ModerationResult> {
    const unsafeKeywords = ["nsfw", "explicit", "adult", "xxx", "nude", "topless"];
    const nonHumanKeywords = ["object", "thing", "landscape", "animal", "car"];
    const aiKeywords = ["ai-generated", "midjourney", "stablediffusion"];
    const multiKeywords = ["group", "multiple-people", "crowd"];
    const minorKeywords = ["minor", "child", "kid"];
    const urlLower = imageUrl.toLowerCase();

    await new Promise((resolve) => setTimeout(resolve, 50));

    const failureReasons: string[] = [];
    const isHuman = !nonHumanKeywords.some((k) => urlLower.includes(k));

    if (purpose === "display") {
      if (!isHuman) {
        failureReasons.push("Photo must clearly show a person. Objects-only images are not allowed.");
      }
      if (multiKeywords.some((k) => urlLower.includes(k))) {
        failureReasons.push(
          "Please use a photo where you are the main subject. Clear group photos are not allowed for your display picture."
        );
      }
    }

    if (aiKeywords.some((k) => urlLower.includes(k))) {
      failureReasons.push("AI-generated images are not allowed. Please upload a real photo.");
    }
    if (unsafeKeywords.some((k) => urlLower.includes(k))) {
      failureReasons.push("Nudity is not allowed. Swimwear and suggestive photos are fine.");
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
      isHuman: purpose === "gallery" ? isHuman : true,
      categories: { adult: 0.1, racy: 0.1, aiGenerated: 0.1, peopleCount: 1, minor: 0.1 }
    };
  }

  /**
   * Sightengine API — models: nudity-2.1, faces, people-counting, face-age, genai
   * Docs: https://sightengine.com/docs/
   */
  private async checkWithSightengine(
    imageUrl: string,
    purpose: ModerationPurpose
  ): Promise<ModerationResult> {
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

    return this.evaluateSightengineResult(data, purpose);
  }

  private evaluateSightengineResult(data: any, purpose: ModerationPurpose): ModerationResult {
    const failureReasons: string[] = [];

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

    if (purpose === "display") {
      if (!isHuman || peopleCountLabel === "0" || (peopleCount === 0 && faces.length === 0)) {
        failureReasons.push("Photo must clearly show a person. Objects-only images are not allowed.");
      } else {
        const prominentFaces = this.countProminentFaces(faces);
        // Only reject when 2+ clear co-subjects. Background / blurry people are fine.
        if (prominentFaces >= 2) {
          failureReasons.push(
            "Please use a photo where you are the main subject. Clear group photos are not allowed for your display picture."
          );
        }
      }
    }

    // --- Minors ---
    let maxMinor = 0;
    for (const face of faces) {
      const minor = Number(face?.attributes?.age?.minor ?? face?.attributes?.minor ?? 0);
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
    const multiSubjectPenalty =
      purpose === "display" && this.countProminentFaces(faces) >= 2 ? 0.9 : 0;
    const confidence = unsafe
      ? Math.max(adultScore, aiGenerated, maxMinor, multiSubjectPenalty)
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

  /** Normalized face area from Sightengine x1/y1/x2/y2 (or legacy w/h). */
  private faceArea(face: any): number {
    const x1 = Number(face?.x1);
    const y1 = Number(face?.y1);
    const x2 = Number(face?.x2);
    const y2 = Number(face?.y2);
    if ([x1, y1, x2, y2].every((n) => Number.isFinite(n))) {
      return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    }
    const w = Number(face?.w);
    const h = Number(face?.h);
    if (Number.isFinite(w) && Number.isFinite(h)) {
      return Math.max(0, w) * Math.max(0, h);
    }
    return 0;
  }

  /**
   * Count faces that look like co-equal subjects (not background / incidental).
   * A face is prominent if it is large enough absolutely AND relative to the largest face.
   */
  private countProminentFaces(faces: any[]): number {
    if (!Array.isArray(faces) || faces.length === 0) return 0;
    const areas = faces.map((f) => this.faceArea(f));
    const maxArea = Math.max(...areas, 0);
    if (maxArea <= 0) {
      // No usable boxes — fall back to raw face count only when exactly one face.
      return faces.length === 1 ? 1 : faces.length >= 2 ? 2 : 0;
    }
    return areas.filter(
      (area) => area >= PROMINENT_FACE_MIN_AREA && area >= PROMINENT_FACE_RELATIVE_AREA * maxArea
    ).length;
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

  private async checkWithGoogleVision(
    imageUrl: string,
    purpose: ModerationPurpose
  ): Promise<ModerationResult> {
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

    if (purpose === "display") {
      if (!isHuman) {
        failureReasons.push("Photo must clearly show a person. Objects-only images are not allowed.");
      } else {
        const prominent = this.countProminentGoogleFaces(faces);
        if (prominent >= 2) {
          failureReasons.push(
            "Please use a photo where you are the main subject. Clear group photos are not allowed for your display picture."
          );
        }
      }
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

  /** Google Vision: use detection confidence + bounding poly area when available. */
  private countProminentGoogleFaces(faces: any[]): number {
    if (!Array.isArray(faces) || faces.length === 0) return 0;

    const scored = faces.map((face) => {
      const confidence = Number(face?.detectionConfidence ?? 0);
      const verts = face?.boundingPoly?.vertices || face?.fdBoundingPoly?.vertices || [];
      let area = 0;
      if (verts.length >= 2) {
        const xs = verts.map((v: any) => Number(v.x) || 0);
        const ys = verts.map((v: any) => Number(v.y) || 0);
        const w = Math.max(...xs) - Math.min(...xs);
        const h = Math.max(...ys) - Math.min(...ys);
        // Pixel area — compare relatively within the same image.
        area = Math.max(0, w) * Math.max(0, h);
      }
      return { confidence, area };
    });

    const maxArea = Math.max(...scored.map((s) => s.area), 0);
    return scored.filter((s) => {
      if (s.confidence < 0.5) return false;
      if (maxArea > 0) {
        return s.area >= PROMINENT_FACE_RELATIVE_AREA * maxArea;
      }
      // No boxes: treat high-confidence faces as prominent.
      return s.confidence >= 0.8;
    }).length;
  }

  private async checkWithAWSRekognition(_imageUrl: string): Promise<ModerationResult> {
    throw new Error("AWS Rekognition implementation requires AWS SDK. Please configure AWS credentials.");
  }
}
