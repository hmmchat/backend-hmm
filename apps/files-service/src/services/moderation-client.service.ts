import { Injectable, HttpException, HttpStatus, Logger } from "@nestjs/common";

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
  failureReasons?: string[];
  error?: string;
}

@Injectable()
export class ModerationClientService {
  private readonly logger = new Logger(ModerationClientService.name);
  private readonly moderationServiceUrl: string;
  private readonly skipModeration: boolean;
  private readonly timeoutMs: number;
  private readonly skipFolders: Set<string>;

  constructor() {
    this.moderationServiceUrl = process.env.MODERATION_SERVICE_URL || "http://localhost:3003";
    const productionOnly = (process.env.MODERATION_PRODUCTION_ONLY ?? "true").toLowerCase() !== "false";
    this.skipModeration =
      envFlagEnabled(process.env.SKIP_MODERATION_CHECK) ||
      process.env.NODE_ENV === "test" ||
      (productionOnly && process.env.NODE_ENV !== "production");
    this.timeoutMs = parseInt(process.env.MODERATION_CHECK_TIMEOUT_MS || "25000", 10);
    this.skipFolders = new Set(
      (process.env.MODERATION_SKIP_FOLDERS || "friends-wall-share")
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean)
    );
  }

  shouldModerate(mimeType: string, folder?: string): boolean {
    if (this.skipModeration) return false;
    if (!mimeType?.startsWith("image/")) return false;
    if (folder && this.skipFolders.has(folder)) return false;
    return true;
  }

  /**
   * Validate a public image URL. Throws 400 with user-facing message on rejection.
   *
   * Default purpose is `gallery` so upload-time checks don't block secondary photos
   * (groups/objects). DP rules are re-enforced in user-service when attaching as display picture.
   */
  async checkImage(
    imageUrl: string,
    purpose: ModerationPurpose = "gallery"
  ): Promise<void> {
    if (this.skipModeration) {
      this.logger.log("Moderation check skipped (non-production or SKIP_MODERATION_CHECK)");
      return;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(`${this.moderationServiceUrl}/moderation/check-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl, purpose }),
        signal: controller.signal
      }).finally(() => clearTimeout(timeoutId));

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
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(`Moderation check failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new HttpException(
        "Unable to verify image content. Please try again later.",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }
}
