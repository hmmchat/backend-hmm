import { Injectable, HttpException, HttpStatus } from "@nestjs/common";
import fetch from "node-fetch";

function envFlagEnabled(value: string | undefined): boolean {
  if (value === undefined || value === "") return false;
  const v = value.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

export type ModerationPurpose = "display" | "gallery";

interface ModerationResult {
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

@Injectable()
export class ModerationClientService {
  private readonly moderationServiceUrl: string;
  private readonly skipModeration: boolean;
  private readonly timeoutMs: number;

  constructor() {
    this.moderationServiceUrl = process.env.MODERATION_SERVICE_URL || "http://localhost:3003";
    // Production-only by default; SKIP_MODERATION_CHECK always wins.
    const productionOnly = (process.env.MODERATION_PRODUCTION_ONLY ?? "true").toLowerCase() !== "false";
    this.skipModeration =
      envFlagEnabled(process.env.SKIP_MODERATION_CHECK) ||
      process.env.NODE_ENV === "test" ||
      (productionOnly && process.env.NODE_ENV !== "production");
    this.timeoutMs = parseInt(process.env.MODERATION_CHECK_TIMEOUT_MS || "25000", 10);
  }

  /**
   * Validate an image URL via moderation-service.
   * Throws HttpException(400) with a frontend-ready message on rejection.
   *
   * @param purpose display = DP (person as main subject); gallery = groups/objects OK
   *
   * Display checks are never skipped: facecard slot 1 / swap-into-DP / profile DP
   * must hit moderation-service even if SKIP_MODERATION_CHECK or non-production
   * NODE_ENV would otherwise no-op. Gallery may still skip outside production.
   * (Upload-time DP rejection lives in files-service; swap only goes through here —
   * skipping display here is how object gallery photos used to become the DP.)
   */
  async checkImage(
    imageUrl: string,
    purpose: ModerationPurpose = "display"
  ): Promise<boolean> {
    if (this.skipModeration && purpose !== "display") {
      console.log("Moderation check skipped (non-production or SKIP_MODERATION_CHECK)");
      return true;
    }
    if (this.skipModeration && purpose === "display") {
      console.warn(
        "Display moderation enforced despite SKIP_MODERATION_CHECK / non-production NODE_ENV"
      );
    }

    try {
      let controller: AbortController | undefined;
      let timeoutId: NodeJS.Timeout | undefined;

      if (typeof AbortController !== "undefined") {
        controller = new AbortController();
        timeoutId = setTimeout(() => controller!.abort(), this.timeoutMs);
      }

      const fetchOptions: any = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl, purpose })
      };

      if (controller) {
        fetchOptions.signal = controller.signal;
      }

      const response = await fetch(
        `${this.moderationServiceUrl}/moderation/check-image`,
        fetchOptions
      ).finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
      });

      if (!response.ok) {
        const error = await response.text().catch(() => "Unknown error");
        throw new Error(`Moderation service error: ${error}`);
      }

      const result = (await response.json()) as ModerationResult;

      // Rely on `safe` + failureReasons. Gallery may have isHuman=false (objects allowed).
      if (!result.safe) {
        const errorMessage =
          result.failureReasons && result.failureReasons.length > 0
            ? result.failureReasons.join(" ")
            : "Image failed moderation check. Please upload an appropriate photo of yourself.";

        throw new HttpException(errorMessage, HttpStatus.BAD_REQUEST);
      }

      return true;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      console.error("Moderation check failed:", error);

      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorName = error instanceof Error ? error.name : "";
      const errorCode = (error as any)?.code || "";

      const isNetworkError =
        errorMessage.includes("ECONNREFUSED") ||
        errorMessage.includes("ENOTFOUND") ||
        errorMessage.includes("ETIMEDOUT") ||
        errorMessage.includes("aborted") ||
        errorMessage.includes("fetch failed") ||
        errorMessage.includes("connect") ||
        errorName === "AbortError" ||
        errorCode === "ECONNREFUSED" ||
        errorCode === "ENOTFOUND" ||
        errorCode === "ETIMEDOUT";

      // Fail closed in production.
      throw new HttpException(
        isNetworkError
          ? "Unable to verify image content. Please try again later."
          : "Unable to verify image content. Please try again later.",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }
}
