import { Injectable, Logger } from "@nestjs/common";
import { NotificationGateway } from "../gateways/notification.gateway.js";

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly notificationGateway: NotificationGateway
  ) {}

  /**
   * Notify friend about squad invitation
   */
  async notifySquadInvitation(
    inviteeId: string,
    invitation: { invitationId: string; inviterId: string }
  ): Promise<void> {
    try {
      await this.notificationGateway.sendNotification(inviteeId, {
        type: "squad_invitation",
        data: {
          invitationId: invitation.invitationId,
          inviterId: invitation.inviterId
        }
      });
      this.logger.log(
        `Notification sent to ${inviteeId} about squad invitation ${invitation.invitationId}`
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to send squad invitation notification to ${inviteeId}:`,
        error.message
      );
      // Don't throw - notification failure shouldn't break invitation flow
    }
  }

  /**
   * Notify inviter when friend accepts invitation
   */
  async notifyInvitationAccepted(
    inviterId: string,
    inviteeId: string
  ): Promise<void> {
    try {
      await this.notificationGateway.sendNotification(inviterId, {
        type: "invitation_accepted",
        data: {
          inviteeId
        }
      });
      this.logger.log(
        `Notification sent to ${inviterId} that ${inviteeId} accepted invitation`
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to send acceptance notification to ${inviterId}:`,
        error.message
      );
      // Don't throw - notification failure shouldn't break acceptance flow
    }
  }

  /**
   * Notify inviter when friend rejects invitation
   */
  async notifyInvitationRejected(
    inviterId: string,
    inviteeId: string
  ): Promise<void> {
    try {
      await this.notificationGateway.sendNotification(inviterId, {
        type: "invitation_rejected",
        data: {
          inviteeId
        }
      });
      this.logger.log(
        `Notification sent to ${inviterId} that ${inviteeId} rejected invitation`
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to send rejection notification to ${inviterId}:`,
        error.message
      );
      // Don't throw - notification failure shouldn't break rejection flow
    }
  }

  /**
   * Notify squad members that the video call went live (lobby → IN_CALL).
   * Used so other members navigate into /video-chat without waiting on lobby poll.
   */
  async notifySquadCallStarted(
    memberId: string,
    data: { roomId: string; sessionId?: string; inviterId: string }
  ): Promise<void> {
    try {
      await this.notificationGateway.sendNotification(memberId, {
        type: "squad:call_started",
        data: {
          roomId: data.roomId,
          sessionId: data.sessionId,
          inviterId: data.inviterId,
          at: Date.now()
        }
      });
      this.logger.log(
        `Notification sent to ${memberId} that squad call started room=${data.roomId}`
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to send squad call started notification to ${memberId}:`,
        error.message
      );
    }
  }

  /**
   * Notify lobby members when new member joins
   */
  async notifySquadMemberJoined(
    memberId: string,
    newMemberId: string
  ): Promise<void> {
    try {
      await this.notificationGateway.sendNotification(memberId, {
        type: "squad_member_joined",
        data: {
          newMemberId
        }
      });
      this.logger.log(
        `Notification sent to ${memberId} that ${newMemberId} joined squad`
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to send member joined notification to ${memberId}:`,
        error.message
      );
      // Don't throw - notification failure shouldn't break squad flow
    }
  }

  /** Immediate client logout after ban (temp or perma). */
  async notifyAccountBanned(
    userId: string,
    data: {
      message: string;
      supportEmail?: string;
      kind?: string;
      code?: string;
      reason?: string;
    }
  ): Promise<void> {
    try {
      await this.notificationGateway.sendNotification(userId, {
        type: "account-banned",
        data: {
          code: data.code || "ACCOUNT_BANNED",
          message: data.message,
          supportEmail: data.supportEmail || "mods@antiscroll.in",
          kind: data.kind,
          reason: data.reason
        }
      });
      this.logger.log(`account-banned notification sent to ${userId}`);
    } catch (error: any) {
      this.logger.error(`Failed to send account-banned to ${userId}:`, error.message);
    }
  }
}
