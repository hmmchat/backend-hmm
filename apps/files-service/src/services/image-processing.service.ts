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
  // Maximum dimensions for images
  private readonly MAX_WIDTH = 2000;
  private readonly MAX_HEIGHT = 2000;
  private readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  // Allowed image MIME types
  private readonly ALLOWED_TYPES = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif"
  ];

  /**
   * Check if MIME type is an image
   */
  isImage(mimeType: string): boolean {
    return this.ALLOWED_TYPES.includes(mimeType.toLowerCase());
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

    if (buffer.length > this.MAX_FILE_SIZE) {
      throw new HttpException(
        `Image too large. Maximum size: ${this.MAX_FILE_SIZE / 1024 / 1024}MB`,
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
      const maxWidth = options?.maxWidth || this.MAX_WIDTH;
      const maxHeight = options?.maxHeight || this.MAX_HEIGHT;
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
  async generateThumbnail(buffer: Buffer, size: number = 200): Promise<Buffer> {
    try {
      return await sharp(buffer)
        .resize(size, size, {
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
