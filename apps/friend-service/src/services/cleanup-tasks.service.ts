import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { FriendService } from "./friend.service.js";
import { FriendsWallImageService } from "./friends-wall-image.service.js";
import { FilesClientService } from "./files-client.service.js";

/**
 * Scheduled tasks for friend-service
 * Runs cleanup jobs periodically
 */
@Injectable()
export class CleanupTasksService {
  private readonly logger = new Logger(CleanupTasksService.name);
  private readonly imageRetentionDays: number;

  constructor(
    private readonly friendService: FriendService,
    private readonly friendsWallImageService: FriendsWallImageService,
    private readonly filesClient: FilesClientService
  ) {
    // Default to 30 days retention, configurable via env
    this.imageRetentionDays = parseInt(process.env.FRIENDS_WALL_IMAGE_RETENTION_DAYS || "30", 10);
  }

  /**
   * Cleanup expired friend requests
   * Runs daily at 2:00 AM
   */
  @Cron("0 2 * * *", {
    name: "cleanup-expired-requests",
    timeZone: "UTC"
  })
  async handleExpiredRequestsCleanup() {
    this.logger.log("Starting expired friend requests cleanup...");
    try {
      await this.friendService.cleanupExpiredRequests();
      this.logger.log("Expired friend requests cleanup completed");
    } catch (error: any) {
      this.logger.error(`Failed to cleanup expired requests: ${error.message}`, error.stack);
    }
  }

  /**
   * Cleanup old friend wall share images
   * Runs daily at 3:00 AM (1 hour after friend requests cleanup)
   */
  @Cron("0 3 * * *", {
    name: "cleanup-old-wall-images",
    timeZone: "UTC"
  })
  async handleOldWallImagesCleanup() {
    this.logger.log(`Starting old friend wall images cleanup (older than ${this.imageRetentionDays} days)...`);
    
    let deletedCount = 0;
    let failedCount = 0;
    let cacheRemovedCount = 0;

    try {
      // Get all cached images older than retention period
      const oldImages = await this.friendsWallImageService.getOldCachedImages(this.imageRetentionDays);
      
      this.logger.log(`Found ${oldImages.length} old images to cleanup`);

      // Delete images in batches to avoid overwhelming the service
      const batchSize = 10;
      for (let i = 0; i < oldImages.length; i += batchSize) {
        const batch = oldImages.slice(i, i + batchSize);
        
        await Promise.allSettled(
          batch.map(async (image) => {
            try {
              // Delete from files-service (R2)
              const deleted = await this.filesClient.deleteFile(image.fileId);
              
              if (deleted) {
                deletedCount++;
                this.logger.debug(`Deleted image ${image.fileId} for user ${image.userId}`);
              } else {
                failedCount++;
                this.logger.warn(`Failed to delete image ${image.fileId} for user ${image.userId}`);
              }

              // Remove from cache regardless of deletion success
              // (cache might be stale if file was already deleted)
              await this.friendsWallImageService.removeCachedImage(image.cacheKey);
              cacheRemovedCount++;
            } catch (error: any) {
              failedCount++;
              this.logger.error(`Error cleaning up image ${image.fileId}: ${error.message}`);
              
              // Still try to remove from cache
              try {
                await this.friendsWallImageService.removeCachedImage(image.cacheKey);
                cacheRemovedCount++;
              } catch (cacheError: any) {
                this.logger.warn(`Failed to remove cache entry ${image.cacheKey}: ${cacheError.message}`);
              }
            }
          })
        );

        // Small delay between batches to avoid rate limiting
        if (i + batchSize < oldImages.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      this.logger.log(
        `Old friend wall images cleanup completed: ` +
        `${deletedCount} deleted, ${failedCount} failed, ${cacheRemovedCount} cache entries removed`
      );
    } catch (error: any) {
      this.logger.error(`Failed to cleanup old wall images: ${error.message}`, error.stack);
    }
  }

  /**
   * Alternative: Run cleanup every 6 hours (for testing or more frequent cleanup)
   * Uncomment if you want more frequent cleanup
   */
  // @Cron(CronExpression.EVERY_6_HOURS, {
  //   name: "cleanup-expired-requests-frequent",
  //   disabled: true // Disable by default, enable if needed
  // })
  // async handleExpiredRequestsCleanupFrequent() {
  //   this.logger.log("Starting frequent expired friend requests cleanup...");
  //   try {
  //     await this.friendService.cleanupExpiredRequests();
  //   } catch (error: any) {
  //     this.logger.error(`Failed to cleanup expired requests: ${error.message}`);
  //   }
  // }
}
