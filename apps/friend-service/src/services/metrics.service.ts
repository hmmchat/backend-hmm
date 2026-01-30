import { Injectable, Logger } from "@nestjs/common";

/**
 * Simple metrics service for tracking friend service operations
 * In production, consider integrating with Prometheus, DataDog, or similar
 */
@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  // In-memory counters (reset on restart)
  // In production, use a proper metrics backend
  private friendRequestSent = 0;
  private friendRequestAccepted = 0;
  private friendRequestRejected = 0;
  private friendRequestAutoAccepted = 0;
  private messageSentToFriend = 0;
  private messageSentToNonFriend = 0;
  private messageSendFailed = 0;
  private walletDeductionFailed = 0;
  private friendshipCreated = 0;
  private friendshipRemoved = 0;
  private userBlocked = 0;
  // Friends wall share metrics
  private friendsWallShareGenerated = 0;
  private friendsWallShareFailed = 0;
  private friendsWallShareCacheHit = 0;
  private friendsWallShareDurations: number[] = []; // Store durations for percentile calculation

  /**
   * Increment friend request sent counter
   */
  incrementFriendRequestSent(autoAccepted: boolean = false) {
    this.friendRequestSent++;
    if (autoAccepted) {
      this.friendRequestAutoAccepted++;
    }
    this.logMetric("friend_request_sent", { autoAccepted });
  }

  /**
   * Increment friend request accepted counter
   */
  incrementFriendRequestAccepted() {
    this.friendRequestAccepted++;
    this.logMetric("friend_request_accepted");
  }

  /**
   * Increment friend request rejected counter
   */
  incrementFriendRequestRejected() {
    this.friendRequestRejected++;
    this.logMetric("friend_request_rejected");
  }

  /**
   * Increment message sent to friend counter
   */
  incrementMessageSentToFriend() {
    this.messageSentToFriend++;
    this.logMetric("message_sent_to_friend");
  }

  /**
   * Increment message sent to non-friend counter
   */
  incrementMessageSentToNonFriend() {
    this.messageSentToNonFriend++;
    this.logMetric("message_sent_to_non_friend");
  }

  /**
   * Increment message send failed counter
   */
  incrementMessageSendFailed() {
    this.messageSendFailed++;
    this.logMetric("message_send_failed", { level: "error" });
  }

  /**
   * Increment wallet deduction failed counter
   */
  incrementWalletDeductionFailed() {
    this.walletDeductionFailed++;
    this.logMetric("wallet_deduction_failed", { level: "error" });
  }

  /**
   * Increment friendship created counter
   */
  incrementFriendshipCreated() {
    this.friendshipCreated++;
    this.logMetric("friendship_created");
  }

  /**
   * Increment friendship removed counter
   */
  incrementFriendshipRemoved() {
    this.friendshipRemoved++;
    this.logMetric("friendship_removed");
  }

  /**
   * Increment user blocked counter
   */
  incrementUserBlocked() {
    this.userBlocked++;
    this.logMetric("user_blocked");
  }

  /**
   * Track friends wall share generation
   */
  incrementFriendsWallShareGenerated(success: boolean, durationMs: number) {
    if (success) {
      this.friendsWallShareGenerated++;
      // Track duration for percentile calculations (keep last 1000)
      this.friendsWallShareDurations.push(durationMs);
      if (this.friendsWallShareDurations.length > 1000) {
        this.friendsWallShareDurations.shift();
      }
      this.logMetric("friends_wall_share_generated", { duration: durationMs });
    } else {
      this.friendsWallShareFailed++;
      this.logMetric("friends_wall_share_failed", { duration: durationMs, level: "error" });
    }
  }

  /**
   * Track cache hit for friends wall share
   */
  incrementFriendsWallShareCacheHit() {
    this.friendsWallShareCacheHit++;
    this.logMetric("friends_wall_share_cache_hit");
  }

  /**
   * Get all metrics as an object
   */
  getMetrics() {
    return {
      friendRequestSent: this.friendRequestSent,
      friendRequestAccepted: this.friendRequestAccepted,
      friendRequestRejected: this.friendRequestRejected,
      friendRequestAutoAccepted: this.friendRequestAutoAccepted,
      messageSentToFriend: this.messageSentToFriend,
      messageSentToNonFriend: this.messageSentToNonFriend,
      messageSendFailed: this.messageSendFailed,
      walletDeductionFailed: this.walletDeductionFailed,
      friendshipCreated: this.friendshipCreated,
      friendshipRemoved: this.friendshipRemoved,
      userBlocked: this.userBlocked,
      friendsWallShareGenerated: this.friendsWallShareGenerated,
      friendsWallShareFailed: this.friendsWallShareFailed,
      friendsWallShareCacheHit: this.friendsWallShareCacheHit,
      // Calculated metrics
      friendRequestAcceptanceRate:
        this.friendRequestSent > 0
          ? ((this.friendRequestAccepted + this.friendRequestAutoAccepted) / this.friendRequestSent) * 100
          : 0,
      messageSuccessRate:
        this.messageSentToFriend + this.messageSentToNonFriend > 0
          ? ((this.messageSentToFriend + this.messageSentToNonFriend) /
              (this.messageSentToFriend + this.messageSentToNonFriend + this.messageSendFailed)) *
            100
          : 100,
      friendsWallShareSuccessRate:
        this.friendsWallShareGenerated + this.friendsWallShareFailed > 0
          ? (this.friendsWallShareGenerated / (this.friendsWallShareGenerated + this.friendsWallShareFailed)) * 100
          : 100,
      friendsWallShareCacheHitRate:
        this.friendsWallShareGenerated + this.friendsWallShareCacheHit > 0
          ? (this.friendsWallShareCacheHit / (this.friendsWallShareGenerated + this.friendsWallShareCacheHit)) * 100
          : 0,
      friendsWallShareAvgDuration: this.calculateAverage(this.friendsWallShareDurations),
      friendsWallShareP50Duration: this.calculatePercentile(this.friendsWallShareDurations, 50),
      friendsWallShareP95Duration: this.calculatePercentile(this.friendsWallShareDurations, 95),
      friendsWallShareP99Duration: this.calculatePercentile(this.friendsWallShareDurations, 99)
    };
  }

  /**
   * Calculate average from array of numbers
   */
  private calculateAverage(numbers: number[]): number {
    if (numbers.length === 0) return 0;
    return numbers.reduce((a, b) => a + b, 0) / numbers.length;
  }

  /**
   * Calculate percentile from array of numbers
   */
  private calculatePercentile(numbers: number[], percentile: number): number {
    if (numbers.length === 0) return 0;
    const sorted = [...numbers].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)] || 0;
  }

  /**
   * Log metric (can be extended to send to metrics backend)
   */
  private logMetric(metricName: string, metadata: any = {}) {
    // In production, send to metrics backend (Prometheus, DataDog, etc.)
    this.logger.debug(`Metric: ${metricName}`, metadata);
  }
}
