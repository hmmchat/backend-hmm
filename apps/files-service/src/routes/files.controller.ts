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
  Query,
  Req
} from "@nestjs/common";
import { FastifyRequest } from "fastify";
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

    // Parse query parameters
    const options = UploadFileSchema.parse(query || {});

    // Get file from multipart request
    const data = await (req as any).file();
    if (!data) {
      throw new HttpException("No file provided", HttpStatus.BAD_REQUEST);
    }

    // Read file buffer
    const buffer = await data.toBuffer();
    const filename = data.filename || "file";
    const mimeType = data.mimetype || "application/octet-stream";

    // Use userId from token if available, otherwise use query param
    const finalUserId = userId || options.userId;

    // Upload file
    const file = await this.filesService.uploadFile(buffer, filename, mimeType, {
      userId: finalUserId,
      folder: options.folder,
      processImage: options.processImage,
      maxWidth: options.maxWidth,
      maxHeight: options.maxHeight,
      quality: options.quality
    });

    return {
      success: true,
      file
    };
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
    const limitNum = limit ? parseInt(limit, 10) : 50;

    const files = await this.filesService.getUserFiles(userId, limitNum);
    return { files };
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
