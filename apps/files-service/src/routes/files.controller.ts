import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Headers,
  HttpException,
  HttpStatus,
  HttpCode,
  Query,
  Req,
  Res
} from "@nestjs/common";
import { FastifyReply, FastifyRequest } from "fastify";
import { FilesService } from "../services/files.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { z } from "zod";
import { verifyToken } from "@hmm/common";

const UploadFileSchema = z.object({
  userId: z.string().optional(),
  folder: z.string().optional(),
  processImage: z.boolean().optional().default(true),
  maxWidth: z.number().positive().optional(),
  maxHeight: z.number().positive().optional(),
  quality: z.number().min(1).max(100).optional()
});

const PresignedUrlSchema = z.object({
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  folder: z.string().optional(),
  expiresIn: z.number().positive().optional().default(3600)
});

@Controller()
export class FilesController {
  constructor(
    private readonly filesService: FilesService,
    private readonly prisma: PrismaService
  ) {}

  private getTokenFromHeader(h?: string): string | null {
    if (!h) return null;
    const [t, v] = h.split(" ");
    return t?.toLowerCase() === "bearer" ? v : null;
  }

  private async verifyTokenAndGetUserId(token: string): Promise<string> {
    const jwkStr = process.env.JWT_PUBLIC_JWK;
    if (!jwkStr || jwkStr === "undefined") {
      throw new HttpException("Server configuration error", HttpStatus.INTERNAL_SERVER_ERROR);
    }
    const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
    const publicJwk = JSON.parse(cleanedJwk);
    const verifyAccess = await verifyToken(publicJwk);
    const payload = await verifyAccess(token);
    return payload.sub;
  }

  /**
   * Upload a file
   * POST /files/upload
   */
  @Post("files/upload")
  async uploadFile(
    @Req() req: FastifyRequest,
    @Headers("authorization") authz?: string,
    @Query() query?: any
  ) {
    const token = this.getTokenFromHeader(authz);
    let userId: string | undefined;

    // If token provided, verify and get userId
    if (token) {
      try {
        userId = await this.verifyTokenAndGetUserId(token);
      } catch (error) {
        // If token invalid, continue without userId (anonymous upload)
      }
    }

    try {
      // Parse query parameters
      const options = UploadFileSchema.parse(query || {});

      // Get file from multipart request
      const data = await (req as any).file();
      if (!data) {
        console.warn("⚠️ No file part found in the request");
        throw new HttpException("No file provided", HttpStatus.BAD_REQUEST);
      }

      // Read file buffer
      const buffer = await data.toBuffer();
      const filename = data.filename || "file";
      const mimeType = data.mimetype || "application/octet-stream";

      // Use userId from token if available, otherwise use query param
      const finalUserId = userId || options.userId;

      console.log(`📂 Processing upload for user: ${finalUserId || 'anonymous'}, filename: ${filename}, type: ${mimeType}`);

      // Upload file
      const file = await this.filesService.uploadFile(buffer, filename, mimeType, {
        userId: finalUserId,
        folder: options.folder,
        processImage: options.processImage,
        maxWidth: options.maxWidth,
        maxHeight: options.maxHeight,
        quality: options.quality
      });

      console.log(`✅ Upload successful: ${file.id}`);

      return {
        success: true,
        file
      };
    } catch (error: any) {
      console.error("❌ FAILED to upload file:", error.message, error.stack);
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "Upload failed due to an internal error",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Get file info
   * GET /files/:fileId
   */
  @Get("files/:fileId")
  async getFile(@Param("fileId") fileId: string) {
    const file = await this.filesService.getFile(fileId);
    return { file };
  }

  /**
   * Proxy external image URLs for client-side canvas export flows.
   * GET /files/image-proxy?url=<encoded-image-url>
   */
  @Get("files/image-proxy")
  async proxyImage(@Query("url") rawUrl?: string, @Req() req?: FastifyRequest, @Res() reply?: FastifyReply) {
    if (!rawUrl) {
      throw new HttpException("Missing url query param", HttpStatus.BAD_REQUEST);
    }

    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new HttpException("Invalid url", HttpStatus.BAD_REQUEST);
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new HttpException("Unsupported url protocol", HttpStatus.BAD_REQUEST);
    }

    const upstream = await fetch(parsed.toString(), {
      redirect: "follow",
      headers: {
        "User-Agent": "beam-files-image-proxy/1.0",
        Accept: "image/*,*/*;q=0.8",
        ...(req?.headers?.referer ? { Referer: String(req.headers.referer) } : {}),
      },
    });

    if (!upstream.ok) {
      throw new HttpException(
        `Upstream fetch failed with status ${upstream.status}`,
        HttpStatus.BAD_GATEWAY,
      );
    }

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const cacheControl =
      upstream.headers.get("cache-control") || "public, max-age=600, s-maxage=600";
    const body = Buffer.from(await upstream.arrayBuffer());

    reply
      .header("Content-Type", contentType)
      .header("Cache-Control", cacheControl)
      .header("Access-Control-Allow-Origin", "*")
      .send(body);
  }

  /**
   * Delete a file
   * DELETE /files/:fileId
   */
  @Delete("files/:fileId")
  async deleteFile(
    @Param("fileId") fileId: string,
    @Headers("authorization") authz?: string
  ) {
    const token = this.getTokenFromHeader(authz);
    let userId: string | undefined;

    if (token) {
      try {
        userId = await this.verifyTokenAndGetUserId(token);
      } catch (error) {
        throw new HttpException("Invalid token", HttpStatus.UNAUTHORIZED);
      }
    }

    await this.filesService.deleteFile(fileId, userId);
    return { success: true };
  }

  /**
   * Generate presigned URL for direct upload
   * POST /files/presigned-url
   */
  @Post("files/presigned-url")
  async generatePresignedUrl(
    @Headers("authorization") authz?: string,
    @Body() body?: any
  ) {
    const token = this.getTokenFromHeader(authz);
    let userId: string | undefined;

    if (token) {
      try {
        userId = await this.verifyTokenAndGetUserId(token);
      } catch (error) {
        throw new HttpException("Invalid token", HttpStatus.UNAUTHORIZED);
      }
    }

    const dto = PresignedUrlSchema.parse(body);

    const result = await this.filesService.generatePresignedUrl(
      dto.filename,
      dto.mimeType,
      userId,
      dto.folder,
      dto.expiresIn
    );

    return {
      success: true,
      ...result
    };
  }

  /**
   * Get user's files
   * GET /me/files
   */
  @Get("me/files")
  async getMyFiles(
    @Headers("authorization") authz: string,
    @Query("limit") limit?: string
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const userId = await this.verifyTokenAndGetUserId(token);
    const limitNum = limit !== undefined && limit !== "" ? parseInt(limit, 10) : undefined;

    const files = await this.filesService.getUserFiles(userId, limitNum);
    return { files };
  }

  /**
   * Readiness check endpoint (database only)
   * GET /ready
   */
  @Get("ready")
  @HttpCode(HttpStatus.OK)
  async readinessCheck() {
    const { HealthChecker } = await import("@hmm/common");
    try {
      const dbCheck = await HealthChecker.checkDatabase(this.prisma, "files-service");
      
      if (dbCheck.status === 'up') {
        return {
          status: 'ready',
          timestamp: new Date().toISOString()
        };
      } else {
        return {
          status: 'not_ready',
          message: dbCheck.message,
          timestamp: new Date().toISOString()
        };
      }
    } catch (error: any) {
      return {
        status: 'not_ready',
        message: error.message || 'Database check failed',
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Health check
   * GET /health
   */
  @Get("health")
  async healthCheck() {
    const { HealthChecker } = await import("@hmm/common");
    const dbCheck = await HealthChecker.checkDatabase(this.prisma, "files-service");
    
    // Check R2 configuration (optional)
    const r2Check = {
      status: (process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID) ? "up" as const : "down" as const,
      message: process.env.R2_ACCOUNT_ID ? "R2 configured" : "R2 not configured"
    };
    
    return HealthChecker.createResponse(
      "files-service",
      {
        database: dbCheck,
        r2: r2Check
      },
      undefined,
      process.env.npm_package_version || "0.0.1"
    );
  }

  /* ---------- Test Endpoints (No Auth Required) ---------- */

  /**
   * Test endpoint: Upload file (bypasses auth)
   * POST /test/files/upload
   */
  @Post("test/files/upload")
  async uploadFileTest(
    @Req() req: FastifyRequest,
    @Query() query?: any
  ) {
    const options = UploadFileSchema.parse(query || {});

    const data = await (req as any).file();
    if (!data) {
      throw new HttpException("No file provided", HttpStatus.BAD_REQUEST);
    }

    const buffer = await data.toBuffer();
    const filename = data.filename || "file";
    const mimeType = data.mimetype || "application/octet-stream";

    const file = await this.filesService.uploadFile(buffer, filename, mimeType, options);

    return {
      success: true,
      file
    };
  }

  /**
   * Test endpoint: Delete file (bypasses auth)
   * DELETE /test/files/:fileId
   */
  @Delete("test/files/:fileId")
  async deleteFileTest(@Param("fileId") fileId: string) {
    await this.filesService.deleteFile(fileId);
    return { success: true };
  }
}
