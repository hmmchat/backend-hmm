import { Injectable, HttpException, HttpStatus, Logger, OnModuleInit } from "@nestjs/common";
import { rewrittenStorageUrlOrNull } from "@hmm/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { R2Service } from "./r2.service.js";
import { ImageProcessingService } from "./image-processing.service.js";
import { ModerationClientService } from "./moderation-client.service.js";

export interface UploadFileDto {
  userId?: string;
  folder?: string;
  processImage?: boolean;
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  /** display = DP rules; gallery = groups/objects OK. Defaults to gallery at upload. */
  moderationPurpose?: "display" | "gallery";
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
export class FilesService implements OnModuleInit {
  private readonly logger = new Logger(FilesService.name);
  private readonly defaultListLimit: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly r2Service: R2Service,
    private readonly imageProcessing: ImageProcessingService,
    private readonly moderationClient: ModerationClientService
  ) {
    this.defaultListLimit = parseInt(process.env.FILES_LIST_DEFAULT_LIMIT || "50", 10);
  }

  async onModuleInit() {
    await this.rewriteExpiredFileUrls();
  }

  private toFileInfo(file: {
    id: string;
    url: string;
    key: string;
    mimeType: string;
    size: number;
    width: number | null;
    height: number | null;
    metadata: unknown;
    createdAt: Date;
  }): FileInfo {
    return {
      id: file.id,
      url: this.stableFileUrl(file.key, file.url),
      key: file.key,
      mimeType: file.mimeType,
      size: file.size,
      width: file.width || undefined,
      height: file.height || undefined,
      metadata: file.metadata as any,
      createdAt: file.createdAt
    };
  }

  private stableFileUrl(key: string, storedUrl: string): string {
    const base = this.r2Service.getPublicUrl();
    if (base) {
      return `${base}/${key.replace(/^\//, "")}`;
    }
    return rewrittenStorageUrlOrNull(storedUrl) || storedUrl;
  }

  private async rewriteExpiredFileUrls() {
    try {
      const files = await this.prisma.file.findMany({
        select: { id: true, key: true, url: true }
      });
      let updated = 0;
      for (const file of files) {
        const next = this.stableFileUrl(file.key, file.url);
        if (next !== file.url) {
          await this.prisma.file.update({
            where: { id: file.id },
            data: { url: next }
          });
          updated++;
        }
      }
      if (updated > 0) {
        this.logger.log(`Rewrote ${updated} expired file URL(s) to the public object URL`);
      }
    } catch (error: any) {
      this.logger.warn(`File URL rewrite skipped: ${error?.message || error}`);
    }
  }

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
    mimeType = this.imageProcessing.resolveImageMimeType(buffer, mimeType, filename);
    const isImage = this.imageProcessing.isImage(mimeType);
    const preserveBytes =
      isImage && (await this.imageProcessing.shouldPreserveImageWithoutReencode(buffer, mimeType));
    const shouldProcessImage = isImage && processImage && !preserveBytes;

    // Validate image if it's an image
    if (isImage) {
      await this.imageProcessing.validateImage(buffer, mimeType, folder);

      // Process static images only. Animated GIFs and SVGs must be preserved as-is.
      if (shouldProcessImage) {
        const processed = await this.imageProcessing.processImage(buffer, {
          maxWidth: options.maxWidth,
          maxHeight: options.maxHeight,
          quality: options.quality
        });
        buffer = processed.buffer;
        mimeType = processed.mimeType;
        filename = this.imageProcessing.filenameForMimeType(filename, mimeType);
      }
    }

    // Generate unique key
    const key = this.r2Service.generateKey(userId || null, filename, folder);

    // Upload to R2
    const url = await this.r2Service.uploadFile(key, buffer, mimeType, {
      userId: userId || "anonymous",
      originalFilename: filename
    });

    // Sightengine only for end-user profile photos (folder=profile-photos).
    // Dashboard catalog uploads (memes, zodiacs, gifts, …) are not moderated.
    if (this.moderationClient.shouldModerate(mimeType, folder)) {
      try {
        await this.moderationClient.checkImage(url, options.moderationPurpose ?? "gallery");
      } catch (error) {
        try {
          await this.r2Service.deleteFile(key);
        } catch (cleanupError) {
          console.error(`Failed to delete rejected upload ${key}:`, cleanupError);
        }
        throw error;
      }
    }

    // Get image metadata if it's an image
    let width: number | undefined;
    let height: number | undefined;
    if (isImage) {
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
          processed: shouldProcessImage,
          animationPreserved: preserveBytes
        }
      }
    });

    return this.toFileInfo(file);
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

    return this.toFileInfo(file);
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
  async getUserFiles(userId: string, limit?: number): Promise<FileInfo[]> {
    const take =
      limit != null && !Number.isNaN(limit) && limit > 0 ? limit : this.defaultListLimit;
    const files = await this.prisma.file.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take
    });

    return files.map((file) => this.toFileInfo(file));
  }

  async deleteAllForUser(userId: string): Promise<number> {
    const files = await this.prisma.file.findMany({
      where: { userId },
      select: { id: true, key: true }
    });
    for (const file of files) {
      try {
        await this.r2Service.deleteFile(file.key);
      } catch (error) {
        console.error(`Failed to delete R2 object ${file.key}: ${error}`);
      }
    }
    const result = await this.prisma.file.deleteMany({ where: { userId } });
    return result.count;
  }
}
