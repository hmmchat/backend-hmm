import { Injectable, HttpException, HttpStatus } from "@nestjs/common";
import sharp from "sharp";

export interface ImageMetadata {
  width: number;
  height: number;
  format: string;
  size: number;
}

export interface ProcessedImage {
  buffer: Buffer;
  metadata: ImageMetadata;
}

@Injectable()
export class ImageProcessingService {
  private readonly maxWidth: number;
  private readonly maxHeight: number;
  private readonly maxFileSize: number;
  private readonly thumbnailSize: number;

  // Allowed image MIME types
  private readonly ALLOWED_TYPES = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif"
  ];

  constructor() {
    this.maxWidth = parseInt(process.env.IMAGE_MAX_WIDTH || "2000", 10);
    this.maxHeight = parseInt(process.env.IMAGE_MAX_HEIGHT || "2000", 10);
    const maxSizeMb = parseInt(process.env.IMAGE_MAX_FILE_SIZE_MB || "10", 10);
    this.maxFileSize = maxSizeMb * 1024 * 1024;
    this.thumbnailSize = parseInt(process.env.IMAGE_THUMBNAIL_SIZE || "200", 10);
  }

  /**
   * Check if MIME type is an image
   */
  isImage(mimeType: string): boolean {
    return this.ALLOWED_TYPES.includes(mimeType.toLowerCase());
  }

  /**
   * Declared MIME is GIF — never run the static image pipeline (would drop frames / change format).
   */
  isAnimatedImage(mimeType: string): boolean {
    return mimeType.toLowerCase() === "image/gif";
  }

  /**
   * True if this buffer must be uploaded without Sharp resize/re-encode.
   * Browsers and clients often mislabel animated GIFs (e.g. application/octet-stream); MIME-only
   * checks flatten them to single-frame JPEG via processImage().
   */
  async shouldPreserveImageWithoutReencode(buffer: Buffer, mimeType: string): Promise<boolean> {
    if (this.isAnimatedImage(mimeType)) return true;

    try {
      const meta = await sharp(buffer).metadata();
      if (meta.format === "gif") return true;
      const pages = meta.pages ?? 1;
      if (pages > 1) return true;
    } catch {
      return false;
    }
    return false;
  }

  /**
   * Validate image file
   */
  async validateImage(buffer: Buffer, mimeType: string): Promise<void> {
    if (!this.isImage(mimeType)) {
      throw new HttpException(
        `Invalid image type. Allowed types: ${this.ALLOWED_TYPES.join(", ")}`,
        HttpStatus.BAD_REQUEST
      );
    }

    if (buffer.length > this.maxFileSize) {
      throw new HttpException(
        `Image too large. Maximum size: ${this.maxFileSize / 1024 / 1024}MB`,
        HttpStatus.BAD_REQUEST
      );
    }

    // Verify it's actually a valid image
    try {
      await sharp(buffer).metadata();
    } catch (error) {
      throw new HttpException("Invalid image file", HttpStatus.BAD_REQUEST);
    }
  }

  /**
   * Process and optimize image
   */
  async processImage(
    buffer: Buffer,
    options?: {
      maxWidth?: number;
      maxHeight?: number;
      quality?: number;
      format?: "jpeg" | "png" | "webp";
    }
  ): Promise<ProcessedImage> {
    try {
      const maxWidth = options?.maxWidth ?? this.maxWidth;
      const maxHeight = options?.maxHeight ?? this.maxHeight;
      const quality = options?.quality || 85;
      const format = options?.format || "jpeg";

      // Get original metadata
      const originalMetadata = await sharp(buffer).metadata();

      // Resize if needed
      let image = sharp(buffer);
      if (originalMetadata.width && originalMetadata.height) {
        if (originalMetadata.width > maxWidth || originalMetadata.height > maxHeight) {
          image = image.resize(maxWidth, maxHeight, {
            fit: "inside",
            withoutEnlargement: true
          });
        }
      }

      // Convert and optimize
      let processedBuffer: Buffer;
      if (format === "webp") {
        processedBuffer = await image.webp({ quality }).toBuffer();
      } else if (format === "png") {
        processedBuffer = await image.png({ quality }).toBuffer();
      } else {
        processedBuffer = await image.jpeg({ quality, mozjpeg: true }).toBuffer();
      }

      // Get final metadata
      const finalMetadata = await sharp(processedBuffer).metadata();

      return {
        buffer: processedBuffer,
        metadata: {
          width: finalMetadata.width || 0,
          height: finalMetadata.height || 0,
          format: finalMetadata.format || format,
          size: processedBuffer.length
        }
      };
    } catch (error: any) {
      throw new HttpException(
        `Failed to process image: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Get image metadata without processing
   */
  async getImageMetadata(buffer: Buffer): Promise<ImageMetadata> {
    try {
      const metadata = await sharp(buffer).metadata();
      return {
        width: metadata.width || 0,
        height: metadata.height || 0,
        format: metadata.format || "unknown",
        size: buffer.length
      };
    } catch (error: any) {
      throw new HttpException(
        `Failed to read image metadata: ${error.message}`,
        HttpStatus.BAD_REQUEST
      );
    }
  }

  /**
   * Generate thumbnail
   */
  async generateThumbnail(buffer: Buffer, size?: number): Promise<Buffer> {
    const thumbSize = size ?? this.thumbnailSize;
    try {
      return await sharp(buffer)
        .resize(thumbSize, thumbSize, {
          fit: "cover",
          position: "center"
        })
        .jpeg({ quality: 80 })
        .toBuffer();
    } catch (error: any) {
      throw new HttpException(
        `Failed to generate thumbnail: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
