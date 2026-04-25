import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Headers,
  HttpException,
  HttpStatus,
  Param,
  Logger,
} from "@nestjs/common";
import { SquadService } from "../services/squad.service.js";
import { NotificationService } from "../services/notification.service.js";
import { UserClientService } from "../services/user-client.service.js";
import { StreamingClientService } from "../services/streaming-client.service.js";
import { FriendClientService } from "../services/friend-client.service.js";
// DTOs are defined but not needed for test endpoints
import { verifyToken, AccessPayload } from "@hmm/common";
import { JWK } from "jose";

@Controller("squad")
export class SquadController {
  private readonly logger = new Logger(SquadController.name);
  private verifyAccess!: (token: string) => Promise<AccessPayload>;
  private publicJwk!: JWK;
  private jwtInitialized = false;

  constructor(
    private readonly squadService: SquadService,
    private readonly notificationService: NotificationService,
    private readonly userClientService: UserClientService,
    private readonly streamingClientService: StreamingClientService,
    private readonly friendClientService: FriendClientService
  ) {}

  private async initializeJWT() {
    if (this.jwtInitialized) return;
    
    const jwkStr = process.env.JWT_PUBLIC_JWK;
    if (!jwkStr || jwkStr === "undefined") {
      throw new Error("JWT_PUBLIC_JWK environment variable is not set or is invalid");
    }
    const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
    this.publicJwk = JSON.parse(cleanedJwk) as JWK;
    this.verifyAccess = await verifyToken(this.publicJwk);
    this.jwtInitialized = true;
  }

  private getTokenFromHeader(h?: string): string | null {
    if (!h) return null;
    const [t, v] = h.split(" ");
    return t?.toLowerCase() === "bearer" ? v : null;
  }

  private async verifyTokenAndGetUserId(token: string): Promise<string> {
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }
    await this.initializeJWT();
    const payload = await this.verifyAccess(token);
    return payload.sub;
  }

  private async resolveLobbyRoom(memberIds: string[], preferredUserId?: string): Promise<{
    roomId?: string;
    sessionId?: string;
  }> {
    const squadSet = new Set((memberIds || []).filter(Boolean));
    const candidates = [...new Set([preferredUserId, ...memberIds].filter(Boolean) as string[])];
    const roomIds = new Set<string>();
    for (const uid of candidates) {
      const room = await this.streamingClientService.getUserActiveRoom(uid);
      if (room?.exists && room.roomId) {
        roomIds.add(room.roomId);
      }
    }
    if (!roomIds.size) return {};

    let best: { roomId: string; sessionId?: string; overlap: number; participants: number } | null = null;
    for (const roomId of roomIds) {
      const details = await this.streamingClientService.getRoomById(roomId);
      if (!details?.exists) continue;
      const participantIds = ((details.participants || []) as Array<{ userId: string }>)
        .map((p) => p?.userId)
        .filter(Boolean);
      const overlap = participantIds.filter((id) => squadSet.has(id)).length;
      const participants = participantIds.length;
      const row = { roomId, sessionId: details.id, overlap, participants };
      if (!best) {
        best = row;
        continue;
      }
      // Prefer the room with highest squad overlap, then larger participant count.
      if (row.overlap > best.overlap || (row.overlap === best.overlap && row.participants > best.participants)) {
        best = row;
      }
    }
    if (!best?.roomId) return {};
    return { roomId: best.roomId, sessionId: best.sessionId };
  }

  private async ensureUserJoinedSquadRoom(
    roomId: string,
    userId: string,
    memberIds: string[]
  ): Promise<void> {
    const active = await this.streamingClientService.getUserActiveRoom(userId);
    if (active?.exists && active.roomId === roomId) {
      return;
    }
    try {
      await this.streamingClientService.addParticipantInternal(roomId, userId);
    } catch (e: any) {
      const msg = String(e?.message || e || "");
      if (/already (in room|a participant|participant)/i.test(msg)) {
        return;
      }
      if (/room is full|maximum|full/i.test(msg)) {
        // Defensive cleanup: if room is full, expire pending invites from current lobby members.
        const unique = [...new Set((memberIds || []).filter(Boolean))];
        for (const mid of unique) {
          try {
            await this.squadService.expireInvitations(mid, "Squad lobby full");
          } catch {
            // best effort
          }
        }
      }
      throw e;
    }
  }

  /**
   * Invite friend to squad
   * POST /squad/invite
   */
  @Post("invite")
  async inviteFriend(
    @Headers("authorization") authz: string,
    @Body() body: any
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const userId = await this.verifyTokenAndGetUserId(token);
    const { inviteeId } = body;
    if (!inviteeId) {
      throw new HttpException("inviteeId is required", HttpStatus.BAD_REQUEST);
    }

    // If inviter is currently a member in another host's lobby, append invite flow to that same lobby.
    let lobbyOwnerId = userId;
    const membership = await this.squadService.getLobbyMembershipForUser(userId);
    if (membership?.inviterId) {
      lobbyOwnerId = membership.inviterId;
    }

    const existingForLobby = await this.squadService.findPendingInvitationForInviteeInLobby(
      lobbyOwnerId,
      inviteeId
    );
    if (existingForLobby) {
      return {
        success: true,
        invitationId: existingForLobby.id
      };
    }

    // Create invitation in resolved lobby, but validate friendship edge using the real actor (userId).
    const result = await this.squadService.createSquadInvitation(
      userId,
      inviteeId,
      undefined,
      userId,
      lobbyOwnerId
    );

    // Notify invitee via WebSocket
    await this.notificationService.notifySquadInvitation(inviteeId, {
      invitationId: result.invitationId,
      inviterId: userId
    });

    await this.friendClientService.postSquadInboxMessage({
      kind: "invite",
      inviterId: userId,
      inviteeId,
      invitationId: result.invitationId
    });

    return {
      success: true,
      invitationId: result.invitationId
    };
  }

  /**
   * Generate external invite link (for sharing)
   * POST /squad/invite-external
   */
  @Post("invite-external")
  async inviteExternal(
    @Headers("authorization") authz: string
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const userId = await this.verifyTokenAndGetUserId(token);

    // If sender is a member in another host's lobby, attach external invite to that canonical lobby.
    let lobbyOwnerId = userId;
    const membership = await this.squadService.getLobbyMembershipForUser(userId);
    if (membership?.inviterId) {
      lobbyOwnerId = membership.inviterId;
    }

    // Create external invitation
    const result = await this.squadService.createSquadInvitation(
      userId,
      undefined,
      undefined,
      userId,
      lobbyOwnerId
    );

    // Generate deep link
    const inviteLink = `${process.env.APP_URL || "https://app.hmmchat.live"}/squad?token=${encodeURIComponent(result.inviteToken || "")}`;

    return {
      success: true,
      invitationId: result.invitationId,
      inviteToken: result.inviteToken,
      inviteLink
    };
  }

  /**
   * Accept invitation
   * POST /squad/invitations/:inviteId/accept
   */
  @Post("invitations/:inviteId/accept")
  async acceptInvitation(
    @Headers("authorization") authz: string,
    @Param("inviteId") inviteId: string
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const userId = await this.verifyTokenAndGetUserId(token);

    // Get invitation to find inviter
    const invitation = await this.squadService.getInvitationById(inviteId);
    if (!invitation) {
      throw new HttpException("Invitation not found", HttpStatus.NOT_FOUND);
    }

    // Accept invitation
    await this.squadService.acceptSquadInvitation(inviteId, userId);

    // Resolve canonical lobby from the newly accepted user's live membership.
    let hostInviterId = invitation.inviterId;
    const acceptedMembership = await this.squadService.getLobbyMembershipForUser(userId);
    if (acceptedMembership?.inviterId) {
      hostInviterId = acceptedMembership.inviterId;
    }

    let lateJoinAttach: "not_needed" | "attached" | "no_active_room" | "failed" = "not_needed";

    // If the host already started the call, add this user to the active streaming room
    const lobbyAfterAccept = await this.squadService.getSquadLobby(hostInviterId);
    if (lobbyAfterAccept?.status === "IN_CALL") {
      try {
        const room = await this.resolveLobbyRoom(
          (lobbyAfterAccept.memberIds as string[]) || [],
          hostInviterId
        );
        if (room.roomId) {
          await this.streamingClientService.addParticipantInternal(room.roomId, userId);
          lateJoinAttach = "attached";
        } else {
          lateJoinAttach = "no_active_room";
          this.logger.warn(
            `Squad lobby IN_CALL but no active room for inviter ${hostInviterId}; invitee ${userId} is in lobby only`
          );
        }
      } catch (e: any) {
        lateJoinAttach = "failed";
        this.logger.error(
          `Failed to add squad late joiner ${userId} to inviter room: ${e?.message || e}`
        );
      }
    }

    // Notify inviter
    await this.notificationService.notifyInvitationAccepted(invitation.inviterId, userId);

    let acceptInboxMessage: string | undefined;
    try {
      const profile = await this.userClientService.getUserFullProfileById(userId);
      const uname = profile?.username?.trim();
      if (uname) {
        acceptInboxMessage = `${uname} joined your squad call.`;
      }
    } catch {
      // best-effort; fall back to default copy in friend-service
    }

    await this.friendClientService.postSquadInboxMessage({
      kind: "outcome",
      inviterId: invitation.inviterId,
      inviteeId: userId,
      invitationId: inviteId,
      outcome: "accepted",
      ...(acceptInboxMessage ? { message: acceptInboxMessage } : {})
    });

    return {
      success: true,
      inviterId: hostInviterId,
      lateJoinAttach
    };
  }

  /**
   * Reject invitation
   * POST /squad/invitations/:inviteId/reject
   */
  @Post("invitations/:inviteId/reject")
  async rejectInvitation(
    @Headers("authorization") authz: string,
    @Param("inviteId") inviteId: string
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const userId = await this.verifyTokenAndGetUserId(token);

    // Get invitation to find inviter
    const invitation = await this.squadService.getInvitationById(inviteId);
    if (!invitation) {
      throw new HttpException("Invitation not found", HttpStatus.NOT_FOUND);
    }

    // Reject invitation
    await this.squadService.rejectSquadInvitation(inviteId, userId);

    // Notify inviter
    await this.notificationService.notifyInvitationRejected(invitation.inviterId, userId);

    await this.friendClientService.postSquadInboxMessage({
      kind: "outcome",
      inviterId: invitation.inviterId,
      inviteeId: userId,
      invitationId: inviteId,
      outcome: "rejected"
    });

    return {
      success: true,
      inviterId: invitation.inviterId
    };
  }

  /**
   * Get current squad lobby
   * GET /squad/lobby
   */
  @Get("lobby")
  async getLobby(
    @Headers("authorization") authz?: string
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const userId = await this.verifyTokenAndGetUserId(token);

    let lobby = await this.squadService.getSquadLobby(userId);
    if (lobby) {
      await this.squadService.reconcileGhostInCallSquadLobby(
        lobby.inviterId,
        lobby.memberIds as string[],
        lobby.status as string
      );
      lobby = await this.squadService.getSquadLobby(userId);
    }
    if (!lobby) {
      return {
        lobby: null
      };
    }

    return {
      lobby: {
        id: lobby.id,
        inviterId: lobby.inviterId,
        memberIds: lobby.memberIds,
        status: lobby.status,
        createdAt: lobby.createdAt,
        updatedAt: lobby.updatedAt
      }
    };
  }

  /**
   * Squad lobby for current user as host OR accepted member (for joiner UI / polling).
   * GET /squad/lobby/membership
   */
  @Get("lobby/membership")
  async getLobbyMembership(@Headers("authorization") authz?: string) {
    const token = this.getTokenFromHeader(authz || "");
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const userId = await this.verifyTokenAndGetUserId(token);

    let asHost = await this.squadService.getSquadLobby(userId);
    if (asHost) {
      await this.squadService.reconcileGhostInCallSquadLobby(
        asHost.inviterId,
        asHost.memberIds as string[],
        asHost.status as string
      );
      asHost = await this.squadService.getSquadLobby(userId);
    }
    if (asHost) {
      return {
        role: "host" as const,
        lobby: {
          id: asHost.id,
          inviterId: asHost.inviterId,
          memberIds: asHost.memberIds,
          status: asHost.status,
          createdAt: asHost.createdAt,
          updatedAt: asHost.updatedAt
        }
      };
    }

    let membership = await this.squadService.getLobbyMembershipForUser(userId);
    if (!membership) {
      return { role: "none" as const, lobby: null };
    }
    await this.squadService.reconcileGhostInCallSquadLobby(
      membership.inviterId,
      membership.memberIds,
      membership.status
    );
    membership = await this.squadService.getLobbyMembershipForUser(userId);
    if (!membership) {
      return { role: "none" as const, lobby: null };
    }

    return {
      role: membership.inviterId === userId ? ("host" as const) : ("member" as const),
      lobby: {
        id: membership.id,
        inviterId: membership.inviterId,
        memberIds: membership.memberIds,
        status: membership.status,
        createdAt: null,
        updatedAt: null
      }
    };
  }

  /**
   * Quick-invite row on home squad: last up to 3 friends who were squad video co-participants (MRU, server-stored).
   * GET /squad/me/quick-invite-suggestions
   */
  @Get("me/quick-invite-suggestions")
  async getQuickInviteSuggestions(@Headers("authorization") authz?: string) {
    const token = this.getTokenFromHeader(authz || "");
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }
    const userId = await this.verifyTokenAndGetUserId(token);
    return this.squadService.getQuickInviteSuggestions(userId);
  }

  /**
   * Persist squad video co-participants for MRU quick-invite (friends only; merged server-side, max 3).
   * POST /squad/me/quick-invite/record-call-peers
   */
  @Post("me/quick-invite/record-call-peers")
  async recordQuickInviteCallPeers(
    @Headers("authorization") authz: string,
    @Body() body: any
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }
    const userId = await this.verifyTokenAndGetUserId(token);
    const peerUserIds = body?.peerUserIds;
    if (!Array.isArray(peerUserIds)) {
      throw new HttpException("peerUserIds must be an array", HttpStatus.BAD_REQUEST);
    }
    await this.squadService.recordQuickInviteCallPeers(userId, peerUserIds);
    return { success: true };
  }

  /**
   * Enter call with squad (requires 2+ members)
   * POST /squad/lobby/enter-call
   */
  @Post("lobby/enter-call")
  async enterCall(
    @Headers("authorization") authz: string,
    @Body() body?: any
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const userId = await this.verifyTokenAndGetUserId(token);

    let lobby = await this.squadService.getSquadLobby(userId);
    let inviterForLobby = userId;

    if (!lobby) {
      const membership = await this.squadService.getLobbyMembershipForUser(userId);
      if (!membership) {
        throw new HttpException("No squad lobby found", HttpStatus.NOT_FOUND);
      }
      inviterForLobby = membership.inviterId;
      lobby = {
        id: membership.id,
        inviterId: membership.inviterId,
        memberIds: membership.memberIds,
        status: membership.status,
        createdAt: null,
        updatedAt: null
      };
    }

    const memberIds = lobby.memberIds as string[];
    const backgroundOnly = Boolean(body?.background);
    if (!memberIds.includes(userId)) {
      throw new HttpException("You are not a member of this squad lobby", HttpStatus.FORBIDDEN);
    }
    if (memberIds.length < 2) {
      throw new HttpException(
        "At least 2 members required to enter call",
        HttpStatus.BAD_REQUEST
      );
    }

    if (lobby.status === "IN_CALL") {
      let room = await this.resolveLobbyRoom(memberIds, inviterForLobby);
      let roomId = room.roomId;
      let sessionId = room.sessionId;
      if (!roomId || !sessionId) {
        const cleared = await this.squadService.reconcileGhostInCallSquadLobby(
          inviterForLobby,
          memberIds,
          lobby.status as string
        );
        if (cleared) {
          throw new HttpException("This squad call has already ended.", HttpStatus.GONE);
        }
        throw new HttpException(
          "Squad call is active but room details could not be loaded",
          HttpStatus.BAD_GATEWAY
        );
      }
      try {
        await this.ensureUserJoinedSquadRoom(roomId, userId, memberIds);
      } catch (e: any) {
        // Retry once with fresh resolution in case inviter's active room was stale.
        try {
          const retry = await this.resolveLobbyRoom(memberIds, userId);
          if (retry.roomId && retry.sessionId && retry.roomId !== roomId) {
            await this.ensureUserJoinedSquadRoom(retry.roomId, userId, memberIds);
            roomId = retry.roomId;
            sessionId = retry.sessionId;
          } else {
            throw e;
          }
        } catch {
          const msg = String(e?.message || e || "");
          if (/room is full|maximum|full/i.test(msg)) {
            throw new HttpException(
              "This squad call is full. Pending invites have been expired.",
              HttpStatus.CONFLICT
            );
          }
          this.logger.error(`IN_CALL join attach failed for ${userId} in ${roomId}: ${msg}`);
          throw new HttpException(
            "Could not add you to the active squad call. Please try again.",
            HttpStatus.BAD_GATEWAY
          );
        }
      }
      return {
        success: true,
        roomId,
        sessionId,
        memberIds,
        roomType: "squad"
      };
    }

    // If a squad room already exists (e.g., background lobby audio), reuse it.
    let roomId: string | undefined;
    let sessionId: string | undefined;
    const existing = await this.resolveLobbyRoom(memberIds, inviterForLobby);
    if (existing?.roomId && existing?.sessionId) {
      roomId = existing.roomId;
      sessionId = existing.sessionId;
      await this.ensureUserJoinedSquadRoom(roomId, userId, memberIds);
    } else {
      await this.squadService.ensureSquadLobbyMembersMatchedForStreaming(memberIds);
      const roomResult = await this.streamingClientService.createSquadRoom(memberIds);
      roomId = roomResult.roomId;
      sessionId = roomResult.sessionId;
    }

    // Keep lobby in READY/WAITING during background audio setup.
    // Lobby transitions to IN_CALL only on explicit "Meet someone now".
    if (!backgroundOnly) {
      await this.squadService.markLobbyInCall(inviterForLobby);
    }

    return {
      success: true,
      roomId,
      sessionId,
      memberIds,
      roomType: "squad"
    };
  }

  /**
   * Toggle to solo mode (expires all invitations)
   * POST /squad/toggle-solo
   */
  @Post("toggle-solo")
  async toggleSolo(
    @Headers("authorization") authz: string
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const userId = await this.verifyTokenAndGetUserId(token);

    // Expire all pending invitations
    await this.squadService.expireInvitations(userId, "User toggled to solo mode");

    // Delete squad lobby
    await this.squadService.deleteSquadLobby(userId);

    // Update user status back to AVAILABLE (for solo matchmaking)
    // Note: Status update should be handled by frontend/discovery service

    return {
      success: true
    };
  }

  /**
   * Remove a member from current lobby (host removes others; member can remove self).
   * POST /squad/lobby/remove-member
   */
  @Post("lobby/remove-member")
  async removeLobbyMember(
    @Headers("authorization") authz: string,
    @Body() body: any
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }
    const userId = await this.verifyTokenAndGetUserId(token);
    const memberId = body?.memberId;
    if (!memberId) {
      throw new HttpException("memberId is required", HttpStatus.BAD_REQUEST);
    }
    await this.squadService.removeMemberFromCurrentLobby(userId, memberId);
    return { success: true };
  }

  /**
   * Cancel a pending invite targeting inviteeId within actor's current lobby.
   * POST /squad/invitations/cancel
   */
  @Post("invitations/cancel")
  async cancelInvitation(
    @Headers("authorization") authz: string,
    @Body() body: any
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }
    const userId = await this.verifyTokenAndGetUserId(token);
    const inviteeId = body?.inviteeId;
    if (!inviteeId) {
      throw new HttpException("inviteeId is required", HttpStatus.BAD_REQUEST);
    }
    const result = await this.squadService.cancelPendingInvitationInLobby(userId, inviteeId);
    return { success: true, cancelled: result.cancelled, invitationId: result.invitationId ?? null };
  }

  /**
   * Get pending invitations for actor's current lobby (host + members).
   * GET /squad/invitations/pending/lobby
   */
  @Get("invitations/pending/lobby")
  async getPendingInvitationsForLobby(
    @Headers("authorization") authz?: string
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }
    const userId = await this.verifyTokenAndGetUserId(token);
    const invitations = await this.squadService.getPendingInvitationsForLobby(userId);
    return {
      invitations: invitations.map((inv: any) => ({
        id: inv.id,
        inviterId: inv.inviterId,
        inviteeId: inv.inviteeId,
        status: inv.status,
        expiresAt: inv.expiresAt,
        createdAt: inv.createdAt
      }))
    };
  }

  /**
   * Get pending invitations sent by user
   * GET /squad/invitations/pending
   */
  @Get("invitations/pending")
  async getPendingInvitations(
    @Headers("authorization") authz?: string
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const userId = await this.verifyTokenAndGetUserId(token);

    const invitations = await this.squadService.getPendingInvitationsSent(userId);

    return {
      invitations: invitations.map(inv => ({
        id: inv.id,
        inviteeId: inv.inviteeId,
        inviteToken: inv.inviteToken,
        status: inv.status,
        expiresAt: inv.expiresAt,
        createdAt: inv.createdAt
      }))
    };
  }

  /**
   * Get received invitations for user
   * GET /squad/invitations/received
   */
  @Get("invitations/received")
  async getReceivedInvitations(
    @Headers("authorization") authz?: string
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const userId = await this.verifyTokenAndGetUserId(token);

    const invitations = await this.squadService.getReceivedInvitations(userId);

    return {
      invitations: invitations.map(inv => ({
        id: inv.id,
        inviterId: inv.inviterId,
        status: inv.status,
        expiresAt: inv.expiresAt,
        createdAt: inv.createdAt
      }))
    };
  }

  /**
   * Handle external link clicks (for authenticated users)
   * GET /squad/join/:token
   * Note: Frontend should redirect unauthenticated users to login with token in query
   */
  @Get("join/:token")
  async handleExternalLink(
    @Headers("authorization") authz: string,
    @Param("token") token: string
  ) {
    const token_header = this.getTokenFromHeader(authz);
    if (!token_header) {
      throw new HttpException(
        "Authentication required. Please login first and try again.",
        HttpStatus.UNAUTHORIZED
      );
    }

    try {
      const userId = await this.verifyTokenAndGetUserId(token_header);

      // Check if user has profile (check if username exists, which indicates profile exists)
      try {
        const userProfile = await this.userClientService.getUserFullProfileById(userId);
        
        // If user doesn't have a profile (no username), redirect to profile creation
        if (!userProfile.username) {
          throw new HttpException(
            {
              message: "Profile not found",
              requiresProfile: true,
              inviteToken: token
            },
            HttpStatus.NOT_FOUND
          );
        }

        // User has profile, handle invitation
        await this.squadService.handleExternalInviteLink(token, userId);
        
        return {
          success: true,
          message: "Invitation accepted successfully",
          redirectTo: "squad"
        };
      } catch (error: any) {
        if (error instanceof HttpException) {
          throw error;
        }
        // Profile doesn't exist or other error
        throw new HttpException(
          {
            message: "Profile not found",
            requiresProfile: true,
            inviteToken: token
          },
          HttpStatus.NOT_FOUND
        );
      }
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      
      // Check if invitation is invalid/expired
      try {
        await this.squadService.getInvitationByToken(token);
      } catch (invError: any) {
        throw new HttpException(
          {
            message: "Invitation not found or expired",
            expired: true
          },
          HttpStatus.BAD_REQUEST
        );
      }
      
      throw new HttpException(
        "Failed to process invitation",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /* ---------- Test Endpoints (No Auth Required) ---------- */

  /**
   * Test endpoint: Invite friend (bypasses auth)
   * POST /squad/test/invite
   */
  @Post("test/invite")
  async inviteFriendTest(@Body() body: any) {
    const { inviterId, inviteeId } = body;
    if (!inviterId || !inviteeId) {
      throw new HttpException("inviterId and inviteeId are required", HttpStatus.BAD_REQUEST);
    }

    const result = await this.squadService.createSquadInvitation(inviterId, inviteeId);

    // Notify invitee via WebSocket
    await this.notificationService.notifySquadInvitation(inviteeId, {
      invitationId: result.invitationId,
      inviterId
    });

    return {
      success: true,
      invitationId: result.invitationId
    };
  }

  /**
   * Test endpoint: Generate external invite link (bypasses auth)
   * POST /squad/test/invite-external
   */
  @Post("test/invite-external")
  async inviteExternalTest(@Body() body: any) {
    const { inviterId } = body;
    if (!inviterId) {
      throw new HttpException("inviterId is required", HttpStatus.BAD_REQUEST);
    }

    const result = await this.squadService.createSquadInvitation(inviterId);

    const inviteLink = `${process.env.APP_URL || "https://app.hmmchat.live"}/squad?token=${encodeURIComponent(result.inviteToken || "")}`;

    return {
      success: true,
      invitationId: result.invitationId,
      inviteToken: result.inviteToken,
      inviteLink
    };
  }

  /**
   * Test endpoint: Accept invitation (bypasses auth)
   * POST /squad/test/invitations/:inviteId/accept
   */
  @Post("test/invitations/:inviteId/accept")
  async acceptInvitationTest(
    @Param("inviteId") inviteId: string,
    @Body() body: any
  ) {
    const { inviteeId } = body;
    if (!inviteeId) {
      throw new HttpException("inviteeId is required", HttpStatus.BAD_REQUEST);
    }

    const invitation = await this.squadService.getInvitationById(inviteId);
    if (!invitation) {
      throw new HttpException("Invitation not found", HttpStatus.NOT_FOUND);
    }

    await this.squadService.acceptSquadInvitation(inviteId, inviteeId);

    let hostInviterId = invitation.inviterId;
    const acceptedMembership = await this.squadService.getLobbyMembershipForUser(inviteeId);
    if (acceptedMembership?.inviterId) {
      hostInviterId = acceptedMembership.inviterId;
    }

    const lobbyAfterAccept = await this.squadService.getSquadLobby(hostInviterId);
    if (lobbyAfterAccept?.status === "IN_CALL") {
      try {
        const room = await this.resolveLobbyRoom(
          (lobbyAfterAccept.memberIds as string[]) || [],
          hostInviterId
        );
        if (room.roomId) {
          await this.streamingClientService.addParticipantInternal(room.roomId, inviteeId);
        }
      } catch (e: any) {
        this.logger.error(`[test] Squad late join failed: ${e?.message || e}`);
      }
    }

    await this.notificationService.notifyInvitationAccepted(invitation.inviterId, inviteeId);

    const lobby = await this.squadService.getSquadLobby(hostInviterId);
    if (lobby) {
      const memberIds = lobby.memberIds as string[];
      for (const memberId of memberIds) {
        if (memberId !== inviteeId) {
          await this.notificationService.notifySquadMemberJoined(memberId, inviteeId);
        }
      }
    }

    return {
      success: true
    };
  }

  /**
   * Test endpoint: Reject invitation (bypasses auth)
   * POST /squad/test/invitations/:inviteId/reject
   */
  @Post("test/invitations/:inviteId/reject")
  async rejectInvitationTest(
    @Param("inviteId") inviteId: string,
    @Body() body: any
  ) {
    const { inviteeId } = body;
    if (!inviteeId) {
      throw new HttpException("inviteeId is required", HttpStatus.BAD_REQUEST);
    }

    const invitation = await this.squadService.getInvitationById(inviteId);
    if (!invitation) {
      throw new HttpException("Invitation not found", HttpStatus.NOT_FOUND);
    }

    await this.squadService.rejectSquadInvitation(inviteId, inviteeId);

    await this.notificationService.notifyInvitationRejected(invitation.inviterId, inviteeId);

    return {
      success: true
    };
  }

  /**
   * Test endpoint: Get squad lobby (bypasses auth)
   * GET /squad/test/lobby?userId=xxx
   */
  @Get("test/lobby")
  async getLobbyTest(@Query("userId") userId: string) {
    if (!userId) {
      throw new HttpException("userId is required", HttpStatus.BAD_REQUEST);
    }

    const lobby = await this.squadService.getSquadLobby(userId);
    if (!lobby) {
      return {
        lobby: null
      };
    }

    return {
      lobby: {
        id: lobby.id,
        inviterId: lobby.inviterId,
        memberIds: lobby.memberIds,
        status: lobby.status,
        createdAt: lobby.createdAt,
        updatedAt: lobby.updatedAt
      }
    };
  }

  /**
   * Test endpoint: Enter call (bypasses auth)
   * POST /squad/test/lobby/enter-call
   */
  @Post("test/lobby/enter-call")
  async enterCallTest(@Body() body: any) {
    const { userId } = body;
    if (!userId) {
      throw new HttpException("userId is required", HttpStatus.BAD_REQUEST);
    }

    let lobby = await this.squadService.getSquadLobby(userId);
    let inviterForLobby = userId;
    if (!lobby) {
      const membership = await this.squadService.getLobbyMembershipForUser(userId);
      if (!membership) {
        throw new HttpException("No squad lobby found", HttpStatus.NOT_FOUND);
      }
      inviterForLobby = membership.inviterId;
      lobby = {
        id: membership.id,
        inviterId: membership.inviterId,
        memberIds: membership.memberIds,
        status: membership.status,
        createdAt: null,
        updatedAt: null
      };
    }

    const memberIds = lobby.memberIds as string[];
    const backgroundOnly = Boolean(body?.background);
    if (!memberIds.includes(userId)) {
      throw new HttpException("You are not a member of this squad lobby", HttpStatus.FORBIDDEN);
    }
    if (memberIds.length < 2) {
      throw new HttpException(
        "At least 2 members required to enter call",
        HttpStatus.BAD_REQUEST
      );
    }

    if (lobby.status === "IN_CALL") {
      const room = await this.resolveLobbyRoom(memberIds, inviterForLobby);
      const roomId = room.roomId;
      const sessionId = room.sessionId;
      if (!roomId || !sessionId) {
        const cleared = await this.squadService.reconcileGhostInCallSquadLobby(
          inviterForLobby,
          memberIds,
          lobby.status as string
        );
        if (cleared) {
          throw new HttpException("This squad call has already ended.", HttpStatus.GONE);
        }
        throw new HttpException(
          "Squad call is active but room details could not be loaded",
          HttpStatus.BAD_GATEWAY
        );
      }
      await this.ensureUserJoinedSquadRoom(roomId, userId, memberIds);
      return {
        success: true,
        roomId,
        sessionId,
        memberIds,
        roomType: "squad"
      };
    }

    let roomId: string | undefined;
    let sessionId: string | undefined;
    const existing = await this.resolveLobbyRoom(memberIds, inviterForLobby);
    if (existing?.roomId && existing?.sessionId) {
      roomId = existing.roomId;
      sessionId = existing.sessionId;
      await this.ensureUserJoinedSquadRoom(roomId, userId, memberIds);
    } else {
      await this.squadService.ensureSquadLobbyMembersMatchedForStreaming(memberIds);
      let roomResult;
      try {
        roomResult = await this.streamingClientService.createSquadRoom(memberIds);
      } catch (error: any) {
        throw new HttpException(
          `Failed to create squad room: ${error.message}`,
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      }
      roomId = roomResult.roomId;
      sessionId = roomResult.sessionId;
    }

    if (!backgroundOnly) {
      await this.squadService.markLobbyInCall(inviterForLobby);
    }

    return {
      success: true,
      roomId,
      sessionId,
      memberIds,
      roomType: "squad"
    };
  }

  /**
   * Test endpoint: Toggle to solo mode (bypasses auth)
   * POST /squad/test/toggle-solo
   */
  @Post("test/toggle-solo")
  async toggleSoloTest(@Body() body: any) {
    const { userId } = body;
    if (!userId) {
      throw new HttpException("userId is required", HttpStatus.BAD_REQUEST);
    }

    await this.squadService.expireInvitations(userId, "User toggled to solo mode");

    await this.squadService.deleteSquadLobby(userId);

    return {
      success: true
    };
  }

  /**
   * Test endpoint: Get pending invitations (bypasses auth)
   * GET /squad/test/invitations/pending?userId=xxx
   */
  @Get("test/invitations/pending")
  async getPendingInvitationsTest(@Query("userId") userId: string) {
    if (!userId) {
      throw new HttpException("userId is required", HttpStatus.BAD_REQUEST);
    }

    const invitations = await this.squadService.getPendingInvitationsSent(userId);

    return {
      invitations: invitations.map(inv => ({
        id: inv.id,
        inviteeId: inv.inviteeId,
        inviteToken: inv.inviteToken,
        status: inv.status,
        expiresAt: inv.expiresAt,
        createdAt: inv.createdAt
      }))
    };
  }

  /**
   * Test endpoint: Get received invitations (bypasses auth)
   * GET /squad/test/invitations/received?userId=xxx
   */
  @Get("test/invitations/received")
  async getReceivedInvitationsTest(@Query("userId") userId: string) {
    if (!userId) {
      throw new HttpException("userId is required", HttpStatus.BAD_REQUEST);
    }

    const invitations = await this.squadService.getReceivedInvitations(userId);

    return {
      invitations: invitations.map(inv => ({
        id: inv.id,
        inviterId: inv.inviterId,
        status: inv.status,
        expiresAt: inv.expiresAt,
        createdAt: inv.createdAt
      }))
    };
  }

  /**
   * Test endpoint: Handle external link (bypasses auth)
   * GET /squad/test/join/:token?userId=xxx
   */
  @Get("test/join/:token")
  async handleExternalLinkTest(
    @Param("token") token: string,
    @Query("userId") userId: string
  ) {
    if (!userId) {
      throw new HttpException("userId is required", HttpStatus.BAD_REQUEST);
    }

    try {
      await this.squadService.handleExternalInviteLink(token, userId);
      
      return {
        success: true,
        message: "Invitation accepted successfully",
        redirectTo: "squad"
      };
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        "Failed to process invitation",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
