import { Injectable, OnModuleInit, HttpException, HttpStatus } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";

@Injectable()
export class R2Service implements OnModuleInit {
  private s3Client!: S3Client;
  private bucketName!: string;
  private publicUrl!: string;
  private accountId!: string;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const accountId = this.configService.get<string>("R2_ACCOUNT_ID");
    const accessKeyId = this.configService.get<string>("R2_ACCESS_KEY_ID");
    const secretAccessKey = this.configService.get<string>("R2_SECRET_ACCESS_KEY");
    const bucketName = this.configService.get<string>("R2_BUCKET_NAME");
    const publicUrl = this.configService.get<string>("R2_PUBLIC_URL");

    if (!accountId || !accessKeyId || !secretAccessKey || !bucketName || !publicUrl) {
      console.warn("⚠️  R2 configuration missing. File uploads will not work.");
      return;
    }

    this.accountId = accountId;
    this.bucketName = bucketName;
    this.publicUrl = publicUrl.endsWith("/") ? publicUrl.slice(0, -1) : publicUrl;

    // Cloudflare R2 is S3-compatible
    this.s3Client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey
      }
    });
  }

  /**
   * Generate a unique key for a file
   */
  generateKey(userId: string | null, filename: string, folder?: string): string {
    const uuid = uuidv4();
    const timestamp = Date.now();
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const extension = sanitizedFilename.split(".").pop() || "";
    const nameWithoutExt = sanitizedFilename.replace(/\.[^/.]+$/, "");

    if (folder) {
      return userId
        ? `${folder}/${userId}/${timestamp}-${uuid}-${nameWithoutExt}.${extension}`
        : `${folder}/${timestamp}-${uuid}-${nameWithoutExt}.${extension}`;
    }

    return userId
      ? `uploads/${userId}/${timestamp}-${uuid}-${nameWithoutExt}.${extension}`
      : `uploads/${timestamp}-${uuid}-${nameWithoutExt}.${extension}`;
  }

  /**
   * Upload a file to R2
   */
  async uploadFile(
    key: string,
    buffer: Buffer,
    contentType: string,
    metadata?: Record<string, string>
  ): Promise<string> {
    if (!this.s3Client) {
      throw new HttpException("R2 not configured", HttpStatus.INTERNAL_SERVER_ERROR);
    }

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        Metadata: metadata
      });

      await this.s3Client.send(command);

      // Return public URL
      return `${this.publicUrl}/${key}`;
    } catch (error: any) {
      throw new HttpException(
        `Failed to upload file to R2: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Delete a file from R2
   */
  async deleteFile(key: string): Promise<void> {
    if (!this.s3Client) {
      throw new HttpException("R2 not configured", HttpStatus.INTERNAL_SERVER_ERROR);
    }

    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key
      });

      await this.s3Client.send(command);
    } catch (error: any) {
      throw new HttpException(
        `Failed to delete file from R2: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Generate a presigned URL for direct upload
   */
  async generatePresignedUrl(
    key: string,
    contentType: string,
    expiresIn: number = 3600
  ): Promise<string> {
    if (!this.s3Client) {
      throw new HttpException("R2 not configured", HttpStatus.INTERNAL_SERVER_ERROR);
    }

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        ContentType: contentType
      });

      const url = await getSignedUrl(this.s3Client, command, { expiresIn });
      return url;
    } catch (error: any) {
      throw new HttpException(
        `Failed to generate presigned URL: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Extract key from URL
   */
  extractKeyFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      // Remove leading slash
      return urlObj.pathname.startsWith("/") ? urlObj.pathname.slice(1) : urlObj.pathname;
    } catch {
      // If URL parsing fails, assume it's already a key
      return url;
    }
  }

  /**
   * Get public URL base
   */
  getPublicUrl(): string {
    return this.publicUrl || "";
  }
}
