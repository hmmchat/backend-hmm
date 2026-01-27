import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import fetch from "node-fetch";
import FormData from "form-data";

@Injectable()
export class FilesClientService {
  private readonly logger = new Logger(FilesClientService.name);
  private readonly filesServiceUrl: string;

  constructor() {
    this.filesServiceUrl = process.env.FILES_SERVICE_URL || "http://localhost:3008";
  }

  /**
   * Upload image buffer to files-service
   * Returns public URL and fileId
   */
  async uploadImage(
    buffer: Buffer,
    filename: string,
    userId: string
  ): Promise<{ url: string; fileId: string }> {
    try {
      // Create form data for multipart upload
      const formData = new FormData();
      formData.append("file", buffer, {
        filename,
        contentType: "image/jpeg"
      });

      // Upload to files-service with folder parameter
      const url = new URL(`${this.filesServiceUrl}/files/upload`);
      url.searchParams.set("folder", "friends-wall-share");
      url.searchParams.set("userId", userId);
      url.searchParams.set("processImage", "false"); // Already processed

      const response = await fetch(url.toString(), {
        method: "POST",
        headers: {
          "x-service-token": process.env.INTERNAL_SERVICE_TOKEN || "",
          ...formData.getHeaders()
        },
        body: formData,
        signal: AbortSignal.timeout(10000) // 10 second timeout for upload
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Failed to upload image to files-service: ${response.status} - ${errorText}`);
        throw new HttpException(
          `Failed to upload image: ${response.status}`,
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      }

      const data = await response.json() as { success: boolean; file: { id: string; url: string } };
      
      if (!data.success || !data.file) {
        throw new HttpException("Invalid response from files-service", HttpStatus.INTERNAL_SERVER_ERROR);
      }

      return {
        url: data.file.url,
        fileId: data.file.id
      };
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(`Error uploading image: ${error.message}`);
      throw new HttpException(
        `Failed to upload image: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Delete a file from files-service
   * Returns true if successful, false otherwise
   */
  async deleteFile(fileId: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.filesServiceUrl}/files/${fileId}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "x-service-token": process.env.INTERNAL_SERVICE_TOKEN || ""
        },
        signal: AbortSignal.timeout(10000) // 10 second timeout
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.warn(`Failed to delete file ${fileId} from files-service: ${response.status} - ${errorText}`);
        return false;
      }

      return true;
    } catch (error: any) {
      this.logger.warn(`Error deleting file ${fileId}: ${error.message}`);
      return false;
    }
  }
}
