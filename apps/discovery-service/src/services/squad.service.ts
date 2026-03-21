import { Injectable, HttpException, HttpStatus, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { UserClientService } from "./user-client.service.js";
import { FriendClientService } from "./friend-client.service.js";
import { MatchingService } from "./matching.service.js";
import { randomBytes } from "crypto";

@Injectable()
export class SquadService {
  private readonly logger = new Logger(SquadService.name);
  private readonly INVITATION_TIMEOUT_MS: number;
  private readonly MAX_SQUAD_SIZE: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly userClient: UserClientService,
    private readonly friendClient: FriendClientService,
    private readonly matchingService: MatchingService
  ) {
    this.INVITATION_TIMEOUT_MS = parseInt(process.env.SQUAD_INVITATION_TIMEOUT_MS || "600000", 10); // 10 min default
    this.MAX_SQUAD_SIZE = parseInt(process.env.MAX_SQUAD_SIZE || "3", 10); // 1 inviter + 2 invitees
  }

  /**
   * Validate that invitee has ONLINE status (or is external user with link)
   */
  async validateInviteeStatus(inviteeId: string | null, isExternal: boolean = false): Promise<void> {
    if (isExternal || !inviteeId) {
      // External users with link can receive invitations regardless of status
      return;
    }

    try {
      const userProfile = await this.userClient.getUserFullProfileById(inviteeId);
      if (userProfile.status !== "ONLINE") {
        throw new HttpException(
          `User must be ONLINE to receive invitations. Current status: ${userProfile.status}`,
          HttpStatus.BAD_REQUEST
        );
      }
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        "Failed to validate invitee status",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Generate unique token for external link
   */
  private async generateInviteToken(_inviterId: string): Promise<string> {
    // Generate unique token - check for collisions
    let token: string;
    let exists = true;
    
    while (exists) {
      token = randomBytes(32).toString("hex");
      const existing = await (this.prisma as any).squadInvitation.findFirst({
        where: { inviteToken: token }
      });
      exists = !!existing;
    }
    
    return token!;
  }

  /**
   * Create invitation (friend or external)
   */
  async createSquadInvitation(
    inviterId: string,
    inviteeId?: string,
    inviteToken?: string
  ): Promise<{ invitationId: string; inviteToken?: string }> {
    // Validate inviter has squad lobby or create one
    let lobby = await this.getSquadLobby(inviterId);
    if (!lobby) {
      // Create lobby for inviter
      lobby = await this.createSquadLobby(inviterId);
    }

    // Check if squad is full
    const memberIds = lobby.memberIds as string[];
    if (memberIds.length >= this.MAX_SQUAD_SIZE) {
      throw new HttpException(
        `Squad is full. Maximum ${this.MAX_SQUAD_SIZE} members allowed (1 inviter + 2 invitees).`,
        HttpStatus.BAD_REQUEST
      );
    }

    // Check if invitee already in lobby
    if (inviteeId && memberIds.includes(inviteeId)) {
      throw new HttpException(
        "User is already in the squad lobby",
        HttpStatus.BAD_REQUEST
      );
    }

    // Validate invitee status if friend invitation
    if (inviteeId) {
      await this.validateInviteeStatus(inviteeId, false);
      
      // Check if users are friends
      let areFriends = false;
      let friendServiceAvailable = true;
      try {
        areFriends = await this.friendClient.areFriends(inviterId, inviteeId);
        // If friend service returns false, it might be because service is unavailable
        // Check if INTERNAL_SERVICE_TOKEN is configured to determine if we should fall back
        if (!areFriends && !process.env.INTERNAL_SERVICE_TOKEN) {
          friendServiceAvailable = false;
        }
      } catch (error: any) {
        // If friend service throws an error, mark as unavailable and fall back to DB
        friendServiceAvailable = false;
        this.logger.warn(`Friend service unavailable, checking database directly: ${error.message}`);
      }
      
      // If friend service is unavailable or returned false without token, check database directly (for testing)
      if (!areFriends && !friendServiceAvailable) {
        try {
          const sortedIds = [inviterId, inviteeId].sort();
          // Use Prisma's tagged template for safe parameter binding
          const friendship = await (this.prisma as any).$queryRaw`
            SELECT 1 FROM friends 
            WHERE "userId1" = ${sortedIds[0]}::text AND "userId2" = ${sortedIds[1]}::text 
            LIMIT 1
          `;
          areFriends = Array.isArray(friendship) && friendship.length > 0;
          this.logger.debug(`Database friendship check: ${areFriends ? 'found' : 'not found'} for ${sortedIds[0]} and ${sortedIds[1]}`);
        } catch (dbError: any) {
          this.logger.error(`Failed to check friendship in database: ${dbError.message}`);
          // If table doesn't exist, assume not friends
          if (dbError.message?.includes('does not exist') || dbError.message?.includes('relation')) {
            areFriends = false;
          } else {
            throw new HttpException(
              "Can only invite friends to squad",
              HttpStatus.BAD_REQUEST
            );
          }
        }
      }
      
      if (!areFriends) {
        throw new HttpException(
          "Can only invite friends to squad",
          HttpStatus.BAD_REQUEST
        );
      }

      // Check for existing pending invitation
      const existing = await (this.prisma as any).squadInvitation.findFirst({
        where: {
          inviterId,
          inviteeId,
          status: "PENDING"
        }
      });

      if (existing) {
        throw new HttpException(
          "Invitation already sent to this user",
          HttpStatus.BAD_REQUEST
        );
      }
    }

    // Generate token for external invitation if not provided
    if (!inviteeId && !inviteToken) {
      inviteToken = await this.generateInviteToken(inviterId);
    }

    const expiresAt = new Date(Date.now() + this.INVITATION_TIMEOUT_MS);

    const invitation = await (this.prisma as any).squadInvitation.create({
      data: {
        inviterId,
        inviteeId: inviteeId || null,
          inviteToken: inviteToken || null,
          status: "PENDING",
          expiresAt
      }
    });

    this.logger.log(
      `Squad invitation created: ${invitation.id} from ${inviterId} to ${inviteeId || "external"}`
    );

    return {
      invitationId: invitation.id,
      inviteToken: invitation.inviteToken || undefined
    };
  }

  /**
   * Get invitation by ID
   */
  async getInvitationById(inviteId: string): Promise<any> {
    const invitation = await (this.prisma as any).squadInvitation.findUnique({
      where: { id: inviteId }
    });

    return invitation;
  }

  /**
   * Get invitation by external token
   */
  async getInvitationByToken(token: string): Promise<any> {
    const invitation = await (this.prisma as any).squadInvitation.findFirst({
        where: {
          inviteToken: token,
          status: "PENDING"
        }
    });

    if (!invitation) {
      throw new HttpException("Invitation not found or expired", HttpStatus.NOT_FOUND);
    }

    // Validate expiry
    await this.validateInvitationExpiry(invitation);

    return invitation;
  }

  /**
   * Validate invitation expiry
   */
  async validateInvitationExpiry(invitation: any): Promise<void> {
    // Refetch invitation from database to ensure we have the latest expiresAt
    // This is important because the database might have been updated externally (e.g., in tests)
    // Use $queryRawUnsafe with parameterized query to force fresh read from database
    // This bypasses any Prisma caching and ensures we get the latest value
    const invitationId = invitation.id;
    // Use raw query with timestamp with time zone cast to ensure proper timezone handling
    // Cast to timestamptz then to text to preserve timezone info
    const freshInvitationResult = await (this.prisma as any).$queryRawUnsafe(
      `SELECT id, "expiresAt"::timestamptz::text as expires_at_text, "expiresAt", status, "inviterId" FROM squad_invitations WHERE id = $1`,
      invitationId
    );
    
    if (!freshInvitationResult || freshInvitationResult.length === 0) {
      throw new HttpException("Invitation not found", HttpStatus.NOT_FOUND);
    }
    
    const invitationData = freshInvitationResult[0];
    
    // Check timeout expiry first (more specific error message)
    // Use the original expiresAt from Prisma (which handles timezone correctly) if available
    // Otherwise parse the text version
    let expiresAtDate: Date;
    const expiresAtValue = invitationData.expiresAt || invitationData.expires_at_text;
    
    // Prefer Prisma's Date object (handles timezone correctly)
    if (expiresAtValue instanceof Date) {
      expiresAtDate = expiresAtValue;
    } else if (typeof expiresAtValue === 'string') {
      // Parse string - if it doesn't have timezone, assume UTC
      expiresAtDate = new Date(expiresAtValue);
    } else if (expiresAtValue && typeof expiresAtValue === 'object' && 'toISOString' in expiresAtValue) {
      // Handle Prisma DateTime object
      expiresAtDate = new Date(expiresAtValue.toISOString());
    } else {
      // Fallback: convert to string then to Date
      expiresAtDate = new Date(String(expiresAtValue));
    }
    
    // Validate the date is valid
    if (isNaN(expiresAtDate.getTime())) {
      this.logger.error(`Invalid expiresAt date for invitation ${invitationData.id}: ${expiresAtValue}`);
      throw new HttpException("Invalid invitation expiry date", HttpStatus.INTERNAL_SERVER_ERROR);
    }
    
    const now = new Date();
    
    // Debug logging
    this.logger.debug(
      `Validating expiry for invitation ${invitationData.id}: rawExpiresAt=${JSON.stringify(invitationData.expiresAt)}, expiresAt=${expiresAtDate.toISOString()}, now=${now.toISOString()}, expired=${expiresAtDate.getTime() < now.getTime()}`
    );
    
    // Compare timestamps - if expiresAt is in the past, it's expired
    // Use getTime() for reliable comparison
    // Add 1 second buffer to account for clock skew and processing time
    if (expiresAtDate.getTime() < (now.getTime() - 1000)) {
      this.logger.log(`Invitation ${invitationData.id} has expired (expiresAt: ${expiresAtDate.toISOString()}, now: ${now.toISOString()})`);
      // Mark as expired
      await (this.prisma as any).squadInvitation.update({
        where: { id: invitationData.id },
        data: {
          status: "EXPIRED",
          updatedAt: new Date()
        }
      });
      throw new HttpException("Invitation has expired", HttpStatus.BAD_REQUEST);
    }

    // Check inviter status - if inviter is not MATCHED, invitation expires
    // Use invitationData.inviterId from the refetched data
    try {
      const inviterProfile = await this.userClient.getUserFullProfileById(invitationData.inviterId);
      if (inviterProfile.status !== "MATCHED") {
        // Mark as expired
        await (this.prisma as any).squadInvitation.update({
          where: { id: invitationData.id },
          data: {
            status: "EXPIRED",
            updatedAt: new Date()
          }
        });
        throw new HttpException(
          "Invitation expired: inviter is no longer in squad mode",
          HttpStatus.BAD_REQUEST
        );
      }
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      // If we can't verify status, still allow (graceful degradation)
      this.logger.warn(`Failed to verify inviter status for invitation ${invitation.id}:`, error);
    }
  }

  /**
   * Handle external link click for existing users
   */
  async handleExternalInviteLink(token: string, userId: string): Promise<void> {
    const invitation = await this.getInvitationByToken(token);

    // Set user status to ONLINE if not already
    try {
      const userProfile = await this.userClient.getUserFullProfileById(userId);
      if (userProfile.status !== "ONLINE") {
        await this.matchingService.updateUserStatus(userId, "ONLINE");
      }
    } catch (error) {
      this.logger.error(`Failed to update user ${userId} to ONLINE:`, error);
      throw new HttpException(
        "Failed to update user status",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }

    // Auto-accept invitation
    await this.acceptSquadInvitation(invitation.id, userId);
  }

  /**
   * Accept invitation (friend accepts or external user with link)
   */
  async acceptSquadInvitation(inviteId: string, inviteeId: string): Promise<void> {
    // Fetch invitation fresh from database to ensure we have latest expiresAt
    const invitation = await (this.prisma as any).squadInvitation.findUnique({
      where: { id: inviteId }
    });

    if (!invitation) {
      throw new HttpException("Invitation not found", HttpStatus.NOT_FOUND);
    }

    // Validate expiry - this will check the expiresAt from the database
    await this.validateInvitationExpiry(invitation);

    // Check if invitation is for this user
    if (invitation.inviteeId && invitation.inviteeId !== inviteeId) {
      throw new HttpException(
        "This invitation is not for you",
        HttpStatus.FORBIDDEN
      );
    }

    // Check if already accepted/rejected
    if (invitation.status !== "PENDING") {
      throw new HttpException(
        `Invitation is already ${invitation.status.toLowerCase()}`,
        HttpStatus.BAD_REQUEST
      );
    }

    // Use transaction for atomicity
    await (this.prisma as any).$transaction(async (tx: any) => {
      // Update invitation status
      await tx.squadInvitation.update({
        where: { id: inviteId },
        data: {
          status: "ACCEPTED",
          inviteeId: invitation.inviteeId || inviteeId, // Set inviteeId if external
          acceptedAt: new Date(),
          updatedAt: new Date()
        }
      });

      // Add to squad lobby
      await this.addToSquadLobby(invitation.inviterId, inviteeId);

      // Update invitee status to MATCHED
      await this.matchingService.updateUserStatus(inviteeId, "MATCHED");

      // If external user, auto-create friendship with inviter
      if (!invitation.inviteeId) {
        try {
          await this.friendClient.autoCreateFriendship(invitation.inviterId, inviteeId);
          this.logger.log(
            `Auto-created friendship between ${invitation.inviterId} and ${inviteeId}`
          );
        } catch (error) {
          this.logger.warn(
            `Failed to auto-create friendship between ${invitation.inviterId} and ${inviteeId}:`,
            error
          );
          // Continue even if friendship creation fails
        }
      }
    });

    this.logger.log(
      `Squad invitation ${inviteId} accepted by ${inviteeId}`
    );
  }

  /**
   * Reject invitation
   */
  async rejectSquadInvitation(inviteId: string, inviteeId: string): Promise<void> {
    const invitation = await (this.prisma as any).squadInvitation.findUnique({
      where: { id: inviteId }
    });

    if (!invitation) {
      throw new HttpException("Invitation not found", HttpStatus.NOT_FOUND);
    }

    // Check if invitation is for this user
    if (invitation.inviteeId && invitation.inviteeId !== inviteeId) {
      throw new HttpException(
        "This invitation is not for you",
        HttpStatus.FORBIDDEN
      );
    }

    // Check if already accepted/rejected
    if (invitation.status !== "PENDING") {
      throw new HttpException(
        `Invitation is already ${invitation.status.toLowerCase()}`,
        HttpStatus.BAD_REQUEST
      );
    }

    await (this.prisma as any).squadInvitation.update({
      where: { id: inviteId },
      data: {
        status: "REJECTED",
        inviteeId: invitation.inviteeId || inviteeId, // Set inviteeId if external
        rejectedAt: new Date(),
        updatedAt: new Date()
      }
    });

    this.logger.log(
      `Squad invitation ${inviteId} rejected by ${inviteeId}`
    );
  }

  /**
   * Get current squad lobby for inviter
   */
  async getSquadLobby(inviterId: string): Promise<any | null> {
    const lobby = await (this.prisma as any).squadLobby.findUnique({
      where: { inviterId }
    });

    return lobby;
  }

  /**
   * Create squad lobby
   */
  private async createSquadLobby(inviterId: string): Promise<any> {
    // Set inviter status to MATCHED
    await this.matchingService.updateUserStatus(inviterId, "MATCHED");

    const lobby = await (this.prisma as any).squadLobby.create({
      data: {
        inviterId,
        memberIds: [inviterId], // Start with inviter
        status: "WAITING"
      }
    });

    this.logger.log(`Squad lobby created for inviter ${inviterId}`);
    return lobby;
  }

  /**
   * Add member to lobby
   */
  async addToSquadLobby(inviterId: string, memberId: string): Promise<void> {
    const lobby = await this.getSquadLobby(inviterId);
    if (!lobby) {
      throw new HttpException("Squad lobby not found", HttpStatus.NOT_FOUND);
    }

    const memberIds = lobby.memberIds as string[];
    
    // Check if already in lobby
    if (memberIds.includes(memberId)) {
      return; // Already in lobby, no-op
    }

    // Check if squad is full
    if (memberIds.length >= this.MAX_SQUAD_SIZE) {
      throw new HttpException(
        `Squad is full. Maximum ${this.MAX_SQUAD_SIZE} members allowed.`,
        HttpStatus.BAD_REQUEST
      );
    }

    // Add member
    memberIds.push(memberId);
    
    // Update lobby status - READY if at least 2 members, otherwise WAITING
    const newStatus = memberIds.length >= 2 ? "READY" : "WAITING";

    await (this.prisma as any).squadLobby.update({
      where: { inviterId },
      data: {
        memberIds,
        status: newStatus,
        updatedAt: new Date()
      }
    });

    this.logger.log(`Member ${memberId} added to squad lobby for inviter ${inviterId}`);
  }

  /**
   * Remove member from lobby
   */
  async removeFromSquadLobby(inviterId: string, memberId: string): Promise<void> {
    const lobby = await this.getSquadLobby(inviterId);
    if (!lobby) {
      return; // Lobby doesn't exist, no-op
    }

    const memberIds = (lobby.memberIds as string[]).filter((id) => id !== memberId);

    // If no members left, delete lobby
    if (memberIds.length === 0) {
      await (this.prisma as any).squadLobby.delete({
        where: { inviterId }
      });
      this.logger.log(`Squad lobby deleted for inviter ${inviterId} (no members left)`);
      return;
    }

    // Update lobby
    const newStatus = memberIds.length >= 2 ? "READY" : "WAITING";

    await (this.prisma as any).squadLobby.update({
      where: { inviterId },
      data: {
        memberIds,
        status: newStatus,
        updatedAt: new Date()
      }
    });

    this.logger.log(`Member ${memberId} removed from squad lobby for inviter ${inviterId}`);
  }

  /**
   * Expire all pending invitations for inviter
   */
  async expireInvitations(inviterId: string, reason: string): Promise<void> {
    const result = await (this.prisma as any).squadInvitation.updateMany({
      where: {
        inviterId,
        status: "PENDING"
      },
      data: {
        status: "EXPIRED",
        updatedAt: new Date()
      }
    });

    this.logger.log(
      `Expired ${result.count} invitations for inviter ${inviterId}. Reason: ${reason}`
    );
  }

  /**
   * Cleanup expired invitations (run periodically)
   */
  async cleanupExpiredInvitations(): Promise<void> {
    try {
      // Expire invitations past timeout
      const timeoutResult = await (this.prisma as any).squadInvitation.updateMany({
        where: {
          status: "PENDING",
          expiresAt: {
            lt: new Date()
          }
        },
        data: {
          status: "EXPIRED",
          updatedAt: new Date()
        }
      });

      // Check for invitations where inviter status changed
      const pendingInvitations = await (this.prisma as any).squadInvitation.findMany({
        where: {
          status: "PENDING"
        },
        select: {
          id: true,
          inviterId: true
        }
      });

      let statusChangedCount = 0;
      for (const invitation of pendingInvitations) {
        try {
          const inviterProfile = await this.userClient.getUserFullProfileById(invitation.inviterId);
          if (inviterProfile.status !== "MATCHED") {
            await (this.prisma as any).squadInvitation.update({
              where: { id: invitation.id },
              data: {
                status: "EXPIRED",
                updatedAt: new Date()
              }
            });
            statusChangedCount++;
          }
        } catch (error) {
          // Skip if can't verify status
          this.logger.warn(
            `Failed to verify inviter status for invitation ${invitation.id}:`,
            error
          );
        }
      }

      if (timeoutResult.count > 0 || statusChangedCount > 0) {
        this.logger.log(
          `Cleaned up expired invitations: ${timeoutResult.count} by timeout, ${statusChangedCount} by status change`
        );
      }
    } catch (error) {
      this.logger.error("Failed to cleanup expired invitations:", error);
    }
  }

  /**
   * Get pending invitations sent by user
   */
  async getPendingInvitationsSent(inviterId: string): Promise<any[]> {
    const invitations = await (this.prisma as any).squadInvitation.findMany({
      where: {
        inviterId,
        status: "PENDING"
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    return invitations;
  }

  /**
   * Get received invitations for user
   */
  async getReceivedInvitations(inviteeId: string): Promise<any[]> {
    const invitations = await (this.prisma as any).squadInvitation.findMany({
      where: {
        inviteeId,
        status: "PENDING"
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    return invitations;
  }

  /**
   * Mark lobby as IN_CALL when squad enters call
   */
  async markLobbyInCall(inviterId: string): Promise<void> {
    await (this.prisma as any).squadLobby.update({
      where: { inviterId },
      data: {
        status: "IN_CALL",
        enteredCallAt: new Date(),
        updatedAt: new Date()
      }
    });
  }

  /**
   * Delete squad lobby (when call ends or squad disbands)
   */
  async deleteSquadLobby(inviterId: string): Promise<void> {
    await (this.prisma as any).squadLobby.deleteMany({
      where: { inviterId }
    });
    this.logger.log(`Squad lobby deleted for inviter ${inviterId}`);
  }

}
