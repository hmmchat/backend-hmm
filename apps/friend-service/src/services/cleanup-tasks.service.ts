import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { FriendService } from "./friend.service.js";

/**
 * Scheduled tasks for friend-service
 * Runs cleanup jobs periodically
 */
@Injectable()
export class CleanupTasksService {
  private readonly logger = new Logger(CleanupTasksService.name);

  constructor(private readonly friendService: FriendService) {}

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
