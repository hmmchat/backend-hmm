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

  constructor(private configService: ConfigService) { }

  async onModuleInit() {
    const accessKeyId = this.configService.get<string>("R2_ACCESS_KEY_ID");
    const secretAccessKey = this.configService.get<string>("R2_SECRET_ACCESS_KEY");
    const bucketName = this.configService.get<string>("R2_BUCKET_NAME");
    const publicUrl = this.configService.get<string>("R2_PUBLIC_URL");
    const endpoint = this.configService.get<string>("R2_ENDPOINT");
    const region = this.configService.get<string>("R2_REGION") || "auto";

    if (!accessKeyId || !secretAccessKey || !bucketName || !publicUrl) {
      console.warn("⚠️  Storage configuration missing. File uploads will not work.");
      console.warn("Required: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL");
      return;
    }

    this.bucketName = bucketName;
    this.publicUrl = publicUrl.endsWith("/") ? publicUrl.slice(0, -1) : publicUrl;

    // Support both Cloudflare R2 and Backblaze B2 (S3-compatible)
    const s3Config: any = {
      region: region,
      credentials: {
        accessKeyId,
        secretAccessKey
      }
    };

    // If custom endpoint is provided (e.g., Backblaze B2), use it
    if (endpoint) {
      s3Config.endpoint = endpoint;
      console.log(`✅ Using custom S3-compatible endpoint: ${endpoint}`);
    } else {
      // Default to Cloudflare R2
      const accountId = this.configService.get<string>("R2_ACCOUNT_ID");
      if (accountId) {
        s3Config.endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
        console.log(`✅ Using Cloudflare R2 endpoint`);
      }
    }

    this.s3Client = new S3Client(s3Config);
    console.log(`✅ Storage initialized - Bucket: ${this.bucketName}`);
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
   * Upload a file to storage and return presigned URL
   * For private buckets, returns a presigned URL with 1 week expiry
   */
  async uploadFile(
    key: string,
    buffer: Buffer,
    contentType: string,
    metadata?: Record<string, string>
  ): Promise<string> {
    if (!this.s3Client) {
      throw new HttpException("Storage not configured", HttpStatus.SERVICE_UNAVAILABLE);
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

      // Generate presigned URL with 1 week expiry (for private buckets)
      // This allows images to be viewed for 1 week without making bucket public
      const presignedUrl = await this.generatePresignedViewUrl(key, 604800); // 1 week
      return presignedUrl;
    } catch (error: any) {
      throw new HttpException(
        `Failed to upload file: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Delete a file from R2
   */
  async deleteFile(key: string): Promise<void> {
    if (!this.s3Client) {
      throw new HttpException("R2 not configured", HttpStatus.SERVICE_UNAVAILABLE);
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
      throw new HttpException("R2 not configured", HttpStatus.SERVICE_UNAVAILABLE);
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
   * Generate a presigned URL for viewing/downloading a file
   * Default expiry: 1 week (604800 seconds)
   */
  async generatePresignedViewUrl(
    key: string,
    expiresIn: number = 604800  // 1 week in seconds
  ): Promise<string> {
    if (!this.s3Client) {
      throw new HttpException("Storage not configured", HttpStatus.SERVICE_UNAVAILABLE);
    }

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key
      });

      const url = await getSignedUrl(this.s3Client, command, { expiresIn });
      return url;
    } catch (error: any) {
      throw new HttpException(
        `Failed to generate presigned view URL: ${error.message}`,
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
