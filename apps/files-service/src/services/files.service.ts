import { Injectable, HttpException, HttpStatus } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { R2Service } from "./r2.service.js";
import { ImageProcessingService } from "./image-processing.service.js";

export interface UploadFileDto {
  userId?: string;
  folder?: string;
  processImage?: boolean;
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
}

export interface FileInfo {
  id: string;
  url: string;
  key: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  metadata?: any;
  createdAt: Date;
}

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly r2Service: R2Service,
    private readonly imageProcessing: ImageProcessingService
  ) {}

  /**
   * Upload a file
   */
  async uploadFile(
    buffer: Buffer,
    filename: string,
    mimeType: string,
    options: UploadFileDto = {}
  ): Promise<FileInfo> {
    const { userId, folder, processImage = true } = options;

    // Validate image if it's an image
    if (this.imageProcessing.isImage(mimeType)) {
      await this.imageProcessing.validateImage(buffer, mimeType);

      // Process image if requested
      if (processImage) {
        const processed = await this.imageProcessing.processImage(buffer, {
          maxWidth: options.maxWidth,
          maxHeight: options.maxHeight,
          quality: options.quality
        });
        buffer = processed.buffer;
      }
    }

    // Generate unique key
    const key = this.r2Service.generateKey(userId || null, filename, folder);

    // Upload to R2
    const url = await this.r2Service.uploadFile(key, buffer, mimeType, {
      userId: userId || "anonymous",
      originalFilename: filename
    });

    // Get image metadata if it's an image
    let width: number | undefined;
    let height: number | undefined;
    if (this.imageProcessing.isImage(mimeType)) {
      const metadata = await this.imageProcessing.getImageMetadata(buffer);
      width = metadata.width;
      height = metadata.height;
    }

    // Save to database
    const file = await this.prisma.file.create({
      data: {
        userId: userId || null,
        url,
        key,
        mimeType,
        size: buffer.length,
        width,
        height,
        metadata: {
          originalFilename: filename,
          processed: processImage && this.imageProcessing.isImage(mimeType)
        }
      }
    });

    return {
      id: file.id,
      url: file.url,
      key: file.key,
      mimeType: file.mimeType,
      size: file.size,
      width: file.width || undefined,
      height: file.height || undefined,
      metadata: file.metadata as any,
      createdAt: file.createdAt
    };
  }

  /**
   * Get file info
   */
  async getFile(fileId: string): Promise<FileInfo> {
    const file = await this.prisma.file.findUnique({
      where: { id: fileId }
    });

    if (!file) {
      throw new HttpException("File not found", HttpStatus.NOT_FOUND);
    }

    return {
      id: file.id,
      url: file.url,
      key: file.key,
      mimeType: file.mimeType,
      size: file.size,
      width: file.width || undefined,
      height: file.height || undefined,
      metadata: file.metadata as any,
      createdAt: file.createdAt
    };
  }

  /**
   * Delete a file
   */
  async deleteFile(fileId: string, userId?: string): Promise<void> {
    const file = await this.prisma.file.findUnique({
      where: { id: fileId }
    });

    if (!file) {
      throw new HttpException("File not found", HttpStatus.NOT_FOUND);
    }

    // Check ownership if userId provided
    if (userId && file.userId && file.userId !== userId) {
      throw new HttpException("Unauthorized", HttpStatus.FORBIDDEN);
    }

    // Delete from R2
    try {
      await this.r2Service.deleteFile(file.key);
    } catch (error) {
      // Log but don't fail if R2 delete fails (file might already be deleted)
      console.error(`Failed to delete file from R2: ${error}`);
    }

    // Delete from database
    await this.prisma.file.delete({
      where: { id: fileId }
    });
  }

  /**
   * Generate presigned URL for direct upload
   */
  async generatePresignedUrl(
    filename: string,
    mimeType: string,
    userId?: string,
    folder?: string,
    expiresIn: number = 3600
  ): Promise<{ uploadUrl: string; fileId: string; key: string; url: string }> {
    // Generate key
    const key = this.r2Service.generateKey(userId || null, filename, folder);

    // Get public URL from R2 service
    const publicUrl = this.r2Service.getPublicUrl() || "https://r2.hmmchat.live";
    const placeholderUrl = `${publicUrl}/${key}`;
    const file = await this.prisma.file.create({
      data: {
        userId: userId || null,
        url: placeholderUrl,
        key,
        mimeType,
        size: 0, // Will be updated after upload
        metadata: {
          originalFilename: filename,
          presigned: true
        }
      }
    });

    // Generate presigned URL
    const uploadUrl = await this.r2Service.generatePresignedUrl(key, mimeType, expiresIn);

    return {
      uploadUrl,
      fileId: file.id,
      key,
      url: placeholderUrl
    };
  }

  /**
   * Get user's files
   */
  async getUserFiles(userId: string, limit: number = 50): Promise<FileInfo[]> {
    const files = await this.prisma.file.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit
    });

    return files.map((file) => ({
      id: file.id,
      url: file.url,
      key: file.key,
      mimeType: file.mimeType,
      size: file.size,
      width: file.width || undefined,
      height: file.height || undefined,
      metadata: file.metadata as any,
      createdAt: file.createdAt
    }));
  }
}
