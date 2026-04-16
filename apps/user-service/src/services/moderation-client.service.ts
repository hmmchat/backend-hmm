import { Injectable, HttpException, HttpStatus } from "@nestjs/common";
import fetch from "node-fetch";

function envFlagEnabled(value: string | undefined): boolean {
  if (value === undefined || value === "") return false;
  const v = value.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

interface ModerationResult {
  safe: boolean;
  confidence: number;
  isHuman?: boolean;
  categories?: {
    adult?: number;
    racy?: number;
    violence?: number;
  };
  failureReasons?: string[];
  error?: string;
}

@Injectable()
export class ModerationClientService {
  private readonly moderationServiceUrl: string;
  private readonly skipModeration: boolean;

  constructor() {
    this.moderationServiceUrl = process.env.MODERATION_SERVICE_URL || "http://localhost:3003";
    // Allow skipping moderation checks in test/dev environments
    this.skipModeration =
      envFlagEnabled(process.env.SKIP_MODERATION_CHECK) || process.env.NODE_ENV === "test";
  }

  /**
   * Check if an image is safe for work (NSFW check)
   * Calls the moderation-service to validate the image
   */
  async checkImage(imageUrl: string): Promise<boolean> {
    // Skip moderation check if enabled via environment variable or in test mode
    if (this.skipModeration) {
      console.log("Moderation check skipped (SKIP_MODERATION_CHECK set or NODE_ENV=test)");
      return true;
    }

    try {
      // Add timeout to prevent hanging requests (if AbortController is available)
      let controller: AbortController | undefined;
      let timeoutId: NodeJS.Timeout | undefined;
      
      if (typeof AbortController !== "undefined") {
        controller = new AbortController();
        timeoutId = setTimeout(() => controller!.abort(), 5000); // 5 second timeout
      }
      
      const fetchOptions: any = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl })
      };
      
      if (controller) {
        fetchOptions.signal = controller.signal;
      }
      
      const response = await fetch(`${this.moderationServiceUrl}/moderation/check-image`, fetchOptions).finally(() => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      });

      if (!response.ok) {
        const error = await response.text().catch(() => "Unknown error");
        throw new Error(`Moderation service error: ${error}`);
      }

      const result = await response.json() as ModerationResult;

      if (!result.safe) {
        // Use specific error messages if available, otherwise use generic message
        const errorMessage = result.failureReasons && result.failureReasons.length > 0
          ? result.failureReasons.join(" ")
          : "Image failed moderation check. Please upload an appropriate photo of yourself.";
        
        throw new HttpException(
          errorMessage,
          HttpStatus.BAD_REQUEST
        );
      }

      // Also check if human (even if safe, if not human it should fail)
      if (result.isHuman === false) {
        const errorMessage = result.failureReasons && result.failureReasons.length > 0
          ? result.failureReasons.join(" ")
          : "Image must contain a human person. Please upload a photo of yourself.";
        
        throw new HttpException(
          errorMessage,
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
      // For now, we'll fail closed unless in test/dev mode
      console.error("Moderation check failed:", error);
      
      // Check if error is a network/connection error (service unavailable)
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
      
      // In test/dev mode or if it's a network error, allow images if moderation service is unavailable
      const isDevOrTest = 
        process.env.NODE_ENV === "test" || 
        process.env.NODE_ENV === "development" ||
        !process.env.NODE_ENV; // Default to dev mode if NODE_ENV is not set
      
      if (isNetworkError && isDevOrTest) {
        console.warn(`Moderation service unavailable (${errorMessage}) - allowing image in dev/test mode`);
        return true;
      }
      
      // Also allow if it's any error in dev/test mode (more permissive for local development)
      if (isDevOrTest && !isNetworkError) {
        console.warn(`Moderation check error in dev/test mode (${errorMessage}) - allowing image`);
        return true;
      }
      
      throw new HttpException(
        "Unable to verify image content. Please try again later.",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }
}

