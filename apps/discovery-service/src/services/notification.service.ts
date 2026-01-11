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
}
