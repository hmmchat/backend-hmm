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
    // Total lobby members including inviter (default 4 = host + 3 invitees)
    this.MAX_SQUAD_SIZE = parseInt(process.env.MAX_SQUAD_SIZE || "4", 10);
  }

  /**
   * Validate that invitee has ONLINE status (or is external user with link)
   */
  async validateInviteeStatus(inviteeId: string | null, isExternal: boolean = false): Promise<void> {
    if (isExternal || !inviteeId) {
      // External users with link can receive invitations regardless of status
      return;
    }

    // Friend invites are delivered via inbox; do not require ONLINE presence.
    try {
      await this.userClient.getUserFullProfileById(inviteeId);
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        "Failed to validate invitee",
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
        `Squad is full. Maximum ${this.MAX_SQUAD_SIZE} members allowed (including host).`,
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
      try {
        await this.notifyInviteeSquadInviteExpired(
          {
            id: invitationData.id as string,
            inviterId: invitationData.inviterId as string,
            inviteeId: (invitation as any).inviteeId ?? null
          },
          "timeout"
        );
      } catch (e: any) {
        this.logger.warn(`Squad expiry friend notice (timeout) failed:`, e?.message || e);
      }
      throw new HttpException("Invitation has expired", HttpStatus.BAD_REQUEST);
    }

    // Friend squad invites stay valid while the host still has a squad lobby row.
    // User-service status (e.g. ONLINE while browsing Inbox) is not authoritative here.
    try {
      const lobby = await (this.prisma as any).squadLobby.findUnique({
        where: { inviterId: invitationData.inviterId as string }
      });
      if (!lobby) {
        await (this.prisma as any).squadInvitation.update({
          where: { id: invitationData.id },
          data: {
            status: "EXPIRED",
            updatedAt: new Date()
          }
        });
        try {
          await this.notifyInviteeSquadInviteExpired(
            {
              id: invitationData.id as string,
              inviterId: invitationData.inviterId as string,
              inviteeId: (invitation as any).inviteeId ?? null
            },
            "inviter_unavailable"
          );
        } catch (e: any) {
          this.logger.warn(`Squad expiry friend notice (inviter unavailable) failed:`, e?.message || e);
        }
        throw new HttpException(
          "This squad invite is no longer active — the host ended squad setup.",
          HttpStatus.BAD_REQUEST
        );
      }
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.warn(`Failed to verify inviter squad lobby for invitation ${invitation.id}:`, error);
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

    const resolvedInviteeId = invitation.inviteeId || inviteeId;
    let supersededInvites: Array<{ id: string; inviterId: string; inviteeId: string | null }> = [];

    // DB-only transaction — never call user-service/friend HTTP inside $transaction (timeouts → 500).
    await (this.prisma as any).$transaction(async (tx: any) => {
      await tx.squadInvitation.update({
        where: { id: inviteId },
        data: {
          status: "ACCEPTED",
          inviteeId: invitation.inviteeId || inviteeId, // Set inviteeId if external
          acceptedAt: new Date(),
          updatedAt: new Date()
        }
      });

      await this.appendMemberToSquadLobbyDb(tx, invitation.inviterId, inviteeId);

      supersededInvites = await tx.squadInvitation.findMany({
        where: {
          inviteeId: resolvedInviteeId,
          status: "PENDING",
          id: { not: inviteId }
        },
        select: { id: true, inviterId: true, inviteeId: true }
      });

      await tx.squadInvitation.updateMany({
        where: {
          inviteeId: resolvedInviteeId,
          status: "PENDING",
          id: { not: inviteId }
        },
        data: {
          status: "EXPIRED",
          updatedAt: new Date()
        }
      });
      if (supersededInvites.length > 0) {
        this.logger.log(
          `Expired ${supersededInvites.length} other pending squad invites for invitee ${resolvedInviteeId}`
        );
      }
    });

    try {
      await this.matchingService.updateUserStatus(inviteeId, "MATCHED");
    } catch (statusErr: any) {
      this.logger.error(
        `Squad accept: user-service MATCHED failed after DB commit (inviteId=${inviteId}): ${statusErr?.message || statusErr}. Compensating.`
      );
      try {
        await (this.prisma as any).$transaction(async (tx: any) => {
          await tx.squadInvitation.update({
            where: { id: inviteId },
            data: {
              status: "PENDING",
              acceptedAt: null,
              updatedAt: new Date()
            }
          });
          await this.removeMemberFromSquadLobbyDb(tx, invitation.inviterId, inviteeId);
          for (const row of supersededInvites) {
            await tx.squadInvitation.update({
              where: { id: row.id },
              data: { status: "PENDING", updatedAt: new Date() }
            });
          }
        });
      } catch (compErr: any) {
        this.logger.error(
          `Squad accept compensation failed (inviteId=${inviteId}): ${compErr?.message || compErr}`
        );
      }
      throw new HttpException(
        "Could not finish joining the squad. Please try accepting again.",
        HttpStatus.BAD_GATEWAY
      );
    }

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
      }
    }

    for (const row of supersededInvites) {
      if (!row.inviteeId) continue;
      try {
        await this.notifyInviterSupersededByInvitee(row.inviteeId, row.inviterId, row.id);
      } catch (e: any) {
        this.logger.warn(`Failed superseded squad friend notice for ${row.id}:`, e?.message || e);
      }
    }

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
   * Add member to lobby (uses default Prisma client).
   */
  async addToSquadLobby(inviterId: string, memberId: string): Promise<void> {
    await this.appendMemberToSquadLobbyDb(this.prisma as any, inviterId, memberId);
  }

  /**
   * Append a member to the inviter's squad lobby row using the given Prisma client
   * (root client or interactive transaction client).
   */
  private async appendMemberToSquadLobbyDb(
    db: any,
    inviterId: string,
    memberId: string
  ): Promise<void> {
    const lobby = await db.squadLobby.findUnique({
      where: { inviterId }
    });
    if (!lobby) {
      throw new HttpException("Squad lobby not found", HttpStatus.NOT_FOUND);
    }

    const memberIds = [...(lobby.memberIds as string[])];

    if (memberIds.includes(memberId)) {
      return;
    }

    if (memberIds.length >= this.MAX_SQUAD_SIZE) {
      throw new HttpException(
        `Squad is full. Maximum ${this.MAX_SQUAD_SIZE} members allowed.`,
        HttpStatus.BAD_REQUEST
      );
    }

    memberIds.push(memberId);

    const currentLobbyStatus = lobby.status as string;
    const newStatus =
      currentLobbyStatus === "IN_CALL"
        ? "IN_CALL"
        : memberIds.length >= 2
          ? "READY"
          : "WAITING";

    await db.squadLobby.update({
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
   * Streaming room creation requires every participant in MATCHED; squad hosts may be ONLINE
   * while browsing the app, so sync before enter-call.
   */
  async ensureSquadLobbyMembersMatchedForStreaming(memberIds: string[]): Promise<void> {
    const unique = [...new Set(memberIds.filter(Boolean))];
    for (const id of unique) {
      await this.matchingService.updateUserStatus(id, "MATCHED");
    }
  }

  /**
   * Remove member from lobby
   */
  async removeFromSquadLobby(inviterId: string, memberId: string): Promise<void> {
    await this.removeMemberFromSquadLobbyDb(this.prisma as any, inviterId, memberId);
  }

  private async removeMemberFromSquadLobbyDb(db: any, inviterId: string, memberId: string): Promise<void> {
    const lobby = await db.squadLobby.findUnique({
      where: { inviterId }
    });
    if (!lobby) {
      return;
    }

    const memberIds = (lobby.memberIds as string[]).filter((id) => id !== memberId);

    if (memberIds.length === 0) {
      await db.squadLobby.delete({
        where: { inviterId }
      });
      this.logger.log(`Squad lobby deleted for inviter ${inviterId} (no members left)`);
      return;
    }

    const currentLobbyStatus = lobby.status as string;
    const newStatus =
      currentLobbyStatus === "IN_CALL"
        ? "IN_CALL"
        : memberIds.length >= 2
          ? "READY"
          : "WAITING";

    await db.squadLobby.update({
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
    const pending = await (this.prisma as any).squadInvitation.findMany({
      where: { inviterId, status: "PENDING" },
      select: { id: true, inviteeId: true }
    });
    if (pending.length === 0) {
      return;
    }

    await (this.prisma as any).squadInvitation.updateMany({
      where: { inviterId, status: "PENDING" },
      data: { status: "EXPIRED", updatedAt: new Date() }
    });

    let variant: "host_solo" | "host_call" = "host_call";
    if (reason.includes("solo") || reason.includes("Solo")) {
      variant = "host_solo";
    }

    for (const row of pending) {
      try {
        await this.notifyInviteeSquadInviteExpired(row, variant);
      } catch (e: any) {
        this.logger.warn(`Failed squad expiry friend notice for ${row.id}:`, e?.message || e);
      }
    }

    this.logger.log(
      `Expired ${pending.length} invitations for inviter ${inviterId}. Reason: ${reason}`
    );
  }

  /**
   * Cleanup expired invitations (run periodically)
   */
  async cleanupExpiredInvitations(): Promise<void> {
    try {
      const now = new Date();

      const timedOut = await (this.prisma as any).squadInvitation.findMany({
        where: {
          status: "PENDING",
          expiresAt: { lt: now }
        },
        select: { id: true, inviterId: true, inviteeId: true }
      });

      for (const row of timedOut) {
        try {
          await (this.prisma as any).squadInvitation.update({
            where: { id: row.id },
            data: { status: "EXPIRED", updatedAt: new Date() }
          });
          await this.notifyInviteeSquadInviteExpired(row, "timeout");
        } catch (error) {
          this.logger.warn(`Failed timeout-expire for invitation ${row.id}:`, error);
        }
      }

      const pendingInvitations = await (this.prisma as any).squadInvitation.findMany({
        where: { status: "PENDING" },
        select: { id: true, inviterId: true, inviteeId: true }
      });

      let statusChangedCount = 0;
      for (const invitation of pendingInvitations) {
        try {
          const lobby = await (this.prisma as any).squadLobby.findUnique({
            where: { inviterId: invitation.inviterId }
          });
          if (!lobby) {
            await (this.prisma as any).squadInvitation.update({
              where: { id: invitation.id },
              data: {
                status: "EXPIRED",
                updatedAt: new Date()
              }
            });
            await this.notifyInviteeSquadInviteExpired(invitation, "inviter_unavailable");
            statusChangedCount++;
          }
        } catch (error) {
          this.logger.warn(
            `Failed to verify inviter squad lobby for invitation ${invitation.id}:`,
            error
          );
        }
      }

      if (timedOut.length > 0 || statusChangedCount > 0) {
        this.logger.log(
          `Cleaned up expired invitations: ${timedOut.length} by timeout, ${statusChangedCount} by status change`
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

  private noticeBodyForInviteeExpiry(
    variant: "timeout" | "inviter_unavailable" | "host_call" | "host_solo"
  ): string {
    switch (variant) {
      case "timeout":
        return "This squad invite has expired (timed out).";
      case "inviter_unavailable":
        return "This squad invite is no longer available — the host isn’t in squad mode anymore.";
      case "host_call":
        return "This squad invite expired — the squad already started without you.";
      case "host_solo":
        return "This squad invite ended — the host left squad mode.";
      default:
        return "This squad invite is no longer active.";
    }
  }

  private async postSquadFriendThreadNotice(params: {
    fromUserId: string;
    toUserId: string;
    invitationId: string;
    noticeType: string;
    body: string;
  }): Promise<void> {
    await this.friendClient.postSquadInboxMessage({
      kind: "notice",
      fromUserId: params.fromUserId,
      toUserId: params.toUserId,
      invitationId: params.invitationId,
      noticeType: params.noticeType,
      body: params.body
    });
  }

  private async notifyInviteeSquadInviteExpired(
    row: { id: string; inviterId: string; inviteeId: string | null },
    variant: "timeout" | "inviter_unavailable" | "host_call" | "host_solo"
  ): Promise<void> {
    if (!row.inviteeId) return;
    await this.postSquadFriendThreadNotice({
      fromUserId: row.inviterId,
      toUserId: row.inviteeId,
      invitationId: row.id,
      noticeType: `expired_${variant}`,
      body: this.noticeBodyForInviteeExpiry(variant)
    });
  }

  private async notifyInviterSupersededByInvitee(
    inviteeId: string,
    inviterId: string,
    invitationId: string
  ): Promise<void> {
    await this.postSquadFriendThreadNotice({
      fromUserId: inviteeId,
      toUserId: inviterId,
      invitationId,
      noticeType: "superseded_joined_other_squad",
      body: "They joined another squad — this invite is no longer active."
    });
  }

  /**
   * Lobby row for any user who is listed in memberIds (host or accepted guest).
   */
  async getLobbyMembershipForUser(userId: string): Promise<{
    id: string;
    inviterId: string;
    memberIds: string[];
    status: string;
  } | null> {
    const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `SELECT id, "inviterId", "memberIds", status::text as status
       FROM squad_lobbies
       WHERE "memberIds"::jsonb @> jsonb_build_array($1::text)
       LIMIT 1`,
      userId
    );
    if (!rows?.length) return null;
    const r = rows[0];
    const raw = r.memberIds;
    const memberIds = Array.isArray(raw) ? raw : JSON.parse(JSON.stringify(raw));
    return {
      id: r.id,
      inviterId: r.inviterId,
      memberIds,
      status: r.status
    };
  }
}
