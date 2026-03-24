import { Injectable, Logger, NotFoundException, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { MediasoupService } from "./mediasoup.service.js";
import { DiscoveryClientService } from "./discovery-client.service.js";
import { types as MediasoupTypes } from "mediasoup";
import { v4 as uuidv4 } from "uuid";

interface RoomState {
  router: MediasoupTypes.Router;
  participants: Map<string, ParticipantState>;
  viewers: Map<string, ViewerState>;
  isBroadcasting: boolean;
  /** producerId (mediasoup) -> owning participant userId — used so consume responses always carry remote userId */
  producerOwnerById: Map<string, string>;
}

interface ParticipantState {
  userId: string;
  transports: Map<string, MediasoupTypes.WebRtcTransport>;
  producer: {
    audio?: MediasoupTypes.Producer;
    video?: MediasoupTypes.Producer;
  };
  consumers: Map<string, MediasoupTypes.Consumer>;
}

interface ViewerState {
  userId: string;
  transport: MediasoupTypes.WebRtcTransport;
  consumers: Map<string, MediasoupTypes.Consumer>;
}

@Injectable()
export class RoomService {
  private readonly logger = new Logger(RoomService.name);
  private rooms = new Map<string, RoomState>();
  private readonly maxParticipants = parseInt(process.env.MAX_PARTICIPANTS_PER_CALL || "4", 10);
  private readonly pullStrangerWindowMs = this.getPullStrangerWindowMs();
  private pullStrangerExpiryTimers = new Map<string, NodeJS.Timeout>();
  /**
   * GET /users/:id/room is polled often from the video client; each call used to hit user-service reconcile.
   * Throttle per userId to cut latency spikes, timeouts, and gateway 502/504s under load.
   * Set ROOM_RECONCILE_MIN_INTERVAL_MS=0 to disable (always reconcile).
   */
  private readonly roomReconcileMinIntervalMs: number;
  private lastParticipantReconcileAt = new Map<string, number>();
  private lastViewerReconcileAt = new Map<string, number>();

  constructor(
    private prisma: PrismaService,
    private mediasoup: MediasoupService,
    private discoveryClient: DiscoveryClientService
  ) {
    const raw = process.env.ROOM_RECONCILE_MIN_INTERVAL_MS;
    const parsed = raw !== undefined && raw !== "" ? Number.parseInt(raw, 10) : 4000;
    this.roomReconcileMinIntervalMs =
      Number.isFinite(parsed) && parsed >= 0 ? parsed : 4000;
  }

  private getPullStrangerWindowMs(): number {
    const raw = process.env.PULL_STRANGER_WINDOW_MS;
    const parsed = Number.parseInt(raw || "60000", 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
    this.logger.warn(`Invalid PULL_STRANGER_WINDOW_MS="${raw}", falling back to 60000ms`);
    return 60000;
  }

  private clearPullStrangerExpiryTimer(roomId: string): void {
    const existing = this.pullStrangerExpiryTimers.get(roomId);
    if (existing) {
      clearTimeout(existing);
      this.pullStrangerExpiryTimers.delete(roomId);
    }
  }

  private schedulePullStrangerExpiry(roomId: string, enabledByUserId: string): void {
    this.clearPullStrangerExpiryTimer(roomId);

    const timer = setTimeout(async () => {
      try {
        const session = await this.prisma.callSession.findUnique({
          where: { roomId }
        });

        if (!session || !session.pullStrangerEnabled) {
          return;
        }

        await this.prisma.callSession.update({
          where: { id: session.id },
          data: { pullStrangerEnabled: false }
        });

        // Product rule: if nobody joined within the pull window, restore initiator to IN_SQUAD.
        await this.discoveryClient.updateUserStatus(enabledByUserId, "IN_SQUAD").catch((err) => {
          this.logger.error(`Failed to restore pull-stranger host ${enabledByUserId} to IN_SQUAD: ${err.message}`);
        });

        await this.prisma.callEvent.create({
          data: {
            sessionId: session.id,
            eventType: "pull_stranger_expired",
            userId: enabledByUserId,
            metadata: JSON.stringify({ roomId, enabledBy: enabledByUserId, windowMs: this.pullStrangerWindowMs })
          }
        });

        this.logger.log(`Pull stranger expired for room ${roomId}. Host ${enabledByUserId} restored to IN_SQUAD.`);
      } catch (error: any) {
        this.logger.error(`Failed to expire pull stranger for room ${roomId}: ${error?.message || error}`);
      } finally {
        this.pullStrangerExpiryTimers.delete(roomId);
      }
    }, this.pullStrangerWindowMs);

    this.pullStrangerExpiryTimers.set(roomId, timer);
  }

  /** User-service statuses consistent with an active streaming *participant* row */
  private static readonly IN_CALL_PARTICIPANT_STATUSES = new Set([
    "IN_SQUAD",
    "IN_BROADCAST",
    "IN_SQUAD_AVAILABLE",
    "IN_BROADCAST_AVAILABLE",
    // Transient: room rows are committed before discovery finishes MATCHED → IN_SQUAD; GET /users/:id/room
    // must not reconcile-remove participants while status is still MATCHED.
    "MATCHED"
  ]);

  /** User-service statuses consistent with an active *viewer* row (broadcast / waitlist) */
  private static readonly IN_CALL_VIEWER_STATUSES = new Set(["VIEWER", "IN_BROADCAST", "MATCHED"]);

  private shouldReconcileWithUserService(): boolean {
    return process.env.TEST_MODE !== "true" && process.env.STREAMING_SKIP_STATUS_RECONCILE !== "true";
  }

  /**
   * If streaming DB still has an active participant but user-service status is not one of the
   * in-call statuses (IN_SQUAD, IN_BROADCAST, IN_SQUAD_AVAILABLE, IN_BROADCAST_AVAILABLE), remove them
   * so we do not block new matches / rooms.
   */
  private async reconcileStaleParticipantIfNeeded(userId: string): Promise<void> {
    if (!this.shouldReconcileWithUserService()) {
      return;
    }

    const row = await this.fetchActiveParticipantRoom(userId);
    if (!row) {
      return;
    }

    let status: string;
    try {
      status = await this.discoveryClient.getUserStatus(userId);
    } catch {
      return;
    }

    if (RoomService.IN_CALL_PARTICIPANT_STATUSES.has(status)) {
      return;
    }

    this.logger.warn(
      `[Reconcile] User ${userId} has active participant row in room ${row.roomId} but user-service status is ${status}; removing stale participant`
    );

    try {
      await this.removeParticipant(row.roomId, userId);
    } catch (err: any) {
      this.logger.error(`[Reconcile] removeParticipant failed: ${err?.message || err}`);
      try {
        await this.removeParticipantFromDatabase(row.roomId, userId);
      } catch (e2: any) {
        this.logger.error(`[Reconcile] removeParticipantFromDatabase failed: ${e2?.message || e2}`);
      }
    }
  }

  /**
   * If streaming DB has an active viewer but user-service says they are not viewing / broadcast flow, remove viewer row.
   */
  private async runParticipantReconcileThrottled(userId: string): Promise<void> {
    if (this.roomReconcileMinIntervalMs === 0) {
      await this.reconcileStaleParticipantIfNeeded(userId);
      return;
    }
    const now = Date.now();
    const last = this.lastParticipantReconcileAt.get(userId) ?? 0;
    if (now - last < this.roomReconcileMinIntervalMs) {
      return;
    }
    this.lastParticipantReconcileAt.set(userId, now);
    await this.reconcileStaleParticipantIfNeeded(userId);
  }

  private async runViewerReconcileThrottled(userId: string): Promise<void> {
    if (this.roomReconcileMinIntervalMs === 0) {
      await this.reconcileStaleViewerIfNeeded(userId);
      return;
    }
    const now = Date.now();
    const last = this.lastViewerReconcileAt.get(userId) ?? 0;
    if (now - last < this.roomReconcileMinIntervalMs) {
      return;
    }
    this.lastViewerReconcileAt.set(userId, now);
    await this.reconcileStaleViewerIfNeeded(userId);
  }

  private async reconcileStaleViewerIfNeeded(userId: string): Promise<void> {
    if (!this.shouldReconcileWithUserService()) {
      return;
    }

    const viewer = await this.prisma.callViewer.findFirst({
      where: {
        userId,
        leftAt: null
      },
      include: {
        session: true
      }
    });

    if (!viewer || !viewer.session) {
      return;
    }

    if (viewer.session.status !== "IN_BROADCAST") {
      return;
    }

    let status: string;
    try {
      status = await this.discoveryClient.getUserStatus(userId);
    } catch {
      return;
    }

    if (RoomService.IN_CALL_VIEWER_STATUSES.has(status)) {
      return;
    }

    this.logger.warn(
      `[Reconcile] User ${userId} has active viewer row in room ${viewer.session.roomId} but user-service status is ${status}; removing stale viewer`
    );

    try {
      await this.removeViewer(viewer.session.roomId, userId, true);
    } catch (err: any) {
      this.logger.error(`[Reconcile] removeViewer failed: ${err?.message || err}`);
    }
  }

  /**
   * After call_participants rows exist, push user-service MATCHED → IN_SQUAD with retries.
   * Awaited from createRoom to shrink the window where GET /users/:id/room reconcile could
   * see stale MATCHED (mitigated further by IN_CALL_PARTICIPANT_STATUSES including MATCHED).
   * Never throws: room is already persisted; logs if user-service never acks.
   */
  private async syncNewRoomParticipantsToInSquad(userIds: string[]): Promise<void> {
    const maxAttempts = 5;
    const baseDelayMs = 150;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.discoveryClient.updateUserStatuses(userIds, "IN_SQUAD");
        this.logger.log(
          `[createRoom] User-service IN_SQUAD sync ok for ${userIds.length} user(s) (attempt ${attempt})`
        );
        return;
      } catch (err: any) {
        const msg = err?.message || String(err);
        this.logger.warn(
          `[createRoom] IN_SQUAD user-service sync attempt ${attempt}/${maxAttempts} failed: ${msg}`
        );
        if (attempt >= maxAttempts) {
          this.logger.error(
            `[createRoom] IN_SQUAD sync failed after ${maxAttempts} attempts; userIds=${userIds.join(",")}`
          );
          return;
        }
        await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** (attempt - 1)));
      }
    }
  }

  /**
   * Create a new room when 2 users enter IN_SQUAD (accept each other's cards)
   * Note: Single users cannot create rooms, but once created, rooms can have 1 user remain
   */
  async createRoom(
    userIds: string[],
    callType: "matched" | "squad" = "matched"
  ): Promise<{ roomId: string; sessionId: string }> {
    // Validate input first - minimum 2 users required to create a room
    if (userIds.length < 2 || userIds.length > this.maxParticipants) {
      throw new BadRequestException(
        `Room must have between 2 and ${this.maxParticipants} participants to be created`
      );
    }

    // Validate callType-specific rules
    if (callType === "matched" && userIds.length !== 2) {
      throw new BadRequestException(
        "Matched calls must have exactly 2 participants"
      );
    }
    if (callType === "squad") {
      if (userIds.length < 2) {
        throw new BadRequestException(
          "Squad calls must have at least 2 participants to be created"
        );
      }
      if (userIds.length > 3) {
        throw new BadRequestException(
          "Squad calls must have at most 3 participants (1 inviter + 2 invitees)"
        );
      }
    }

    // Check for duplicate user IDs
    const uniqueUserIds = new Set(userIds);
    if (uniqueUserIds.size !== userIds.length) {
      throw new BadRequestException("Duplicate user IDs are not allowed");
    }

    // Drop stale participant rows when user-service no longer says in-call / squad-available / broadcast-available
    // (e.g. WS never connected, tab closed before deploy fix) so "already in room" is accurate
    if (this.shouldReconcileWithUserService()) {
      for (const uid of userIds) {
        await this.reconcileStaleParticipantIfNeeded(uid);
      }
    }

    // BUSINESS RULE: Only users with status MATCHED can create/join rooms
    // Valid source statuses: AVAILABLE, IN_SQUAD_AVAILABLE, IN_BROADCAST_AVAILABLE → MATCHED → IN_SQUAD

    // Check user statuses from user-service
    const invalidStatusUsers: string[] = [];
    const usersInRooms: string[] = [];

    try {
      // Check if any user is already in an active room
      // Always check database to prevent duplicate rooms, even in TEST_MODE
      const activeSessions = await this.prisma.callSession.findMany({
        where: {
          status: {
            in: ["IN_SQUAD", "IN_BROADCAST"] // Users can only be in one active room
          },
          participants: {
            some: {
              userId: { in: userIds },
              status: "active" // Only check active participants
            }
          }
        },
        include: {
          participants: {
            where: {
              userId: { in: userIds },
              status: "active"
            }
          }
        }
      });

      // Find which users are already in rooms
      for (const session of activeSessions) {
        for (const participant of session.participants) {
          if (userIds.includes(participant.userId) && !usersInRooms.includes(participant.userId)) {
            usersInRooms.push(participant.userId);
          }
        }
      }

      // Also check in-memory rooms Map as secondary validation
      for (const [existingRoomId, roomState] of this.rooms.entries()) {
        for (const participantUserId of roomState.participants.keys()) {
          if (userIds.includes(participantUserId) && !usersInRooms.includes(participantUserId)) {
            usersInRooms.push(participantUserId);
            this.logger.warn(
              `User ${participantUserId} found in in-memory room ${existingRoomId} but not in database. This may indicate a sync issue.`
            );
          }
        }
      }

      if (usersInRooms.length > 0) {
        throw new BadRequestException(
          `Users ${usersInRooms.join(", ")} are already in an active room. Please leave the current room before creating a new one.`
        );
      }

      // Validate that all users have MATCHED status (required to create/join room)
      // Only users with _AVAILABLE statuses (AVAILABLE, IN_SQUAD_AVAILABLE, IN_BROADCAST_AVAILABLE) can become MATCHED
      // In TEST_MODE, skip status validation
      if (process.env.TEST_MODE !== "true") {
        for (const userId of userIds) {
          try {
            const userStatus = await this.discoveryClient.getUserStatus(userId);

            // Explicitly reject users with IN_SQUAD or IN_BROADCAST status (they're already in a call)
            if (userStatus === "IN_SQUAD" || userStatus === "IN_BROADCAST") {
              invalidStatusUsers.push(`${userId} (status: ${userStatus} - user is already in an active call)`);
              continue; // Skip to next user
            }

            // Only MATCHED users can create/join rooms
            if (userStatus !== "MATCHED") {
              invalidStatusUsers.push(`${userId} (status: ${userStatus})`);
            }
          } catch (error: any) {
            // If we can't check status (user-service unavailable), log warning but continue in TEST_MODE
            this.logger.warn(`Could not verify status for user ${userId}: ${error.message}`);
            // In production, we should fail if we can't verify status
            if (process.env.TEST_MODE !== "true") {
              throw new BadRequestException(
                `Could not verify user status. Please ensure user-service is running and users are in MATCHED status.`
              );
            }
          }
        }

        if (invalidStatusUsers.length > 0) {
          throw new BadRequestException(
            `Users must be in MATCHED status to create/join rooms. Invalid users: ${invalidStatusUsers.join(", ")}. ` +
            `Valid statuses to become MATCHED: AVAILABLE, IN_SQUAD_AVAILABLE, IN_BROADCAST_AVAILABLE. ` +
            `Users with IN_SQUAD or IN_BROADCAST status cannot join new rooms (they are already in an active call).`
          );
        }
      } else {
        this.logger.log(`[TEST_MODE] Skipping user status validation for room creation`);
      }
    } catch (error: any) {
      // Re-throw BadRequestException
      if (error instanceof BadRequestException) {
        throw error;
      }
      // Re-throw other errors
      throw error;
    }

    try {
      // Create router for this room
      const router = await this.mediasoup.createRouter();

      // Generate room ID
      const roomId = uuidv4();

      // Get previous status for each user before they join.
      // For matched calls, users should return to homepage baseline (ONLINE) after call ends.
      // Explicit _AVAILABLE flows (e.g. pull stranger) track and restore their own status separately.
      const previousStatuses = new Map<string, string>();

      for (const userId of userIds) {
        try {
          // Future enhancement: persist exact pre-match status history.
          // Safe fallback for homepage-centric flow is ONLINE.
          previousStatuses.set(userId, "ONLINE");
        } catch (error) {
          // Default to ONLINE if we can't determine.
          previousStatuses.set(userId, "ONLINE");
        }
      }

      // Determine roles based on callType
      // - matched: First 2 users are HOSTS
      // - squad: All users are HOSTS
      const participantRoles = userIds.map((userId, index) => {
        const previousStatus = previousStatuses.get(userId) || "ONLINE";
        if (callType === "matched") {
          // Matched call: First 2 users are HOSTS
          return {
            userId,
            role: (index < 2 ? "HOST" : "PARTICIPANT") as "HOST" | "PARTICIPANT",
            status: "active",
            previousStatus
          };
        } else {
          // Squad call: All users are HOSTS
          return {
            userId,
            role: "HOST" as "HOST" | "PARTICIPANT",
            status: "active",
            previousStatus
          };
        }
      });

      // Create database session
      const session = await this.prisma.callSession.create({
        data: {
          roomId,
          status: "IN_SQUAD",
          isBroadcasting: false,
          maxParticipants: this.maxParticipants,
          startedAt: new Date(),
          participants: {
            create: participantRoles
          },
          events: {
            create: {
              eventType: "room_created",
              metadata: JSON.stringify({ userIds, callType })
            }
          }
        }
      });

      // Create in-memory room state
      const roomState: RoomState = {
        router,
        participants: new Map(),
        viewers: new Map(),
        isBroadcasting: false,
        producerOwnerById: new Map()
      };

      this.rooms.set(roomId, roomState);

      const hostCount = participantRoles.filter(p => p.role === "HOST").length;
      this.logger.log(
        `Room created: ${roomId} with ${userIds.length} participants (${hostCount} hosts, callType: ${callType})`
      );

      // BUSINESS RULE: user-service status IN_SQUAD — await + retry so clients polling room are less
      // likely to hit reconcile while still MATCHED. Room row already exists.
      await this.syncNewRoomParticipantsToInSquad(userIds);

      // Notify discovery-service (Redis / internal hooks); does not throw on HTTP failure
      await this.discoveryClient.notifyRoomCreated(roomId, userIds);

      return { roomId, sessionId: session.id };
    } catch (error: any) {
      // If it's already a BadRequestException, re-throw it
      if (error instanceof BadRequestException) {
        throw error;
      }
      // Handle Prisma unique constraint violations (P2002)
      if (error?.code === 'P2002') {
        throw new BadRequestException("Duplicate user IDs are not allowed");
      }
      // Re-throw other errors
      this.logger.error(`Error creating room: ${error.message}`, error);
      throw error;
    }
  }

  /**
   * Get room state
   */
  getRoom(roomId: string): RoomState {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new NotFoundException(`Room ${roomId} not found`);
    }
    return room;
  }

  /**
   * Get room details from database
   */
  async getRoomDetails(roomId: string) {
    const session = await this.prisma.callSession.findUnique({
      where: { roomId },
      include: {
        participants: {
          where: {
            status: "active",
            leftAt: null // Only count active participants who haven't left
          },
          select: {
            userId: true,
            role: true,
            joinedAt: true
          }
        },
        viewers: {
          where: {
            leftAt: null // Only count active viewers who haven't left
          },
          select: {
            userId: true,
            joinedAt: true
          }
        }
      }
    });

    if (!session) {
      return null;  // Return null to indicate room doesn't exist
    }

    // If room is ENDED, ensure isBroadcasting is false (data consistency)
    const isBroadcasting = session.status === "ENDED" ? false : session.isBroadcasting;

    return {
      id: session.id,
      roomId: session.roomId,
      status: session.status,
      isBroadcasting,
      participantCount: session.participants.length,
      viewerCount: session.viewers.length,
      participants: session.participants,
      viewers: session.viewers,
      createdAt: session.createdAt,
      startedAt: session.startedAt
    };
  }

  /**
   * Check if room exists (checks both memory and database)
   * If room exists in database but not in memory, reloads it into memory
   */
  async roomExists(roomId: string): Promise<boolean> {
    // First check memory (fast)
    if (this.rooms.has(roomId)) {
      return true;
    }

    // If not in memory, check database
    const session = await this.prisma.callSession.findUnique({
      where: { roomId },
      select: { id: true, status: true }
    });

    if (session && session.status !== "ENDED") {
      // Room exists in database but not in memory - reload it
      this.logger.log(`Room ${roomId} exists in database but not in memory - reloading into memory`);
      try {
        await this.reloadRoomIntoMemory(roomId);
        return true;
      } catch (error: any) {
        this.logger.error(`Failed to reload room ${roomId} into memory: ${error.message}`);
        // Still return true since it exists in database, but operations may fail
        return true;
      }
    }

    return false;
  }

  /**
   * Reload a room from database into memory (for recovery after service restart)
   */
  private async reloadRoomIntoMemory(roomId: string): Promise<void> {
    // Check if already in memory (race condition protection)
    if (this.rooms.has(roomId)) {
      return;
    }

    const session = await this.prisma.callSession.findUnique({
      where: { roomId },
      select: { id: true, status: true, isBroadcasting: true }
    });

    if (!session || session.status === "ENDED") {
      throw new NotFoundException(`Room ${roomId} not found or already ended`);
    }

    // Create new router for the room
    const router = await this.mediasoup.createRouter();

    // Create in-memory room state
    const roomState: RoomState = {
      router,
      participants: new Map(),
      viewers: new Map(),
      isBroadcasting: session.isBroadcasting || false,
      producerOwnerById: new Map()
    };

    this.rooms.set(roomId, roomState);
    this.logger.log(`Room ${roomId} reloaded into memory (status: ${session.status}, broadcasting: ${session.isBroadcasting})`);
  }

  /**
   * Add a participant to an existing room (3rd or 4th person)
   */
  async addParticipant(roomId: string, userId: string): Promise<void> {
    // Try to get room from memory, but continue even if not found (will check DB)
    let room: RoomState | null = null;
    try {
      room = this.getRoom(roomId);
    } catch (error) {
      // Room not in memory, but we'll check database
      this.logger.debug(`Room ${roomId} not in memory when adding participant ${userId}, will check database`);
    }

    const session = await this.prisma.callSession.findUnique({
      where: { roomId },
      include: {
        participants: {
          where: {
            status: "active",
            leftAt: null
          }
        }
      }
    });

    if (!session) {
      throw new NotFoundException(`Session for room ${roomId} not found`);
    }

    // Check participant count from database (source of truth)
    const activeParticipantCount = session.participants.length;
    if (activeParticipantCount >= this.maxParticipants) {
      throw new BadRequestException(
        `Room is full (${activeParticipantCount}/${this.maxParticipants} participants). Maximum ${this.maxParticipants} participants allowed.`
      );
    }

    // Check if user is already a participant (check both memory and database)
    if (room && room.participants.has(userId)) {
      throw new BadRequestException(`User ${userId} is already in room`);
    }

    // Check database to see if user is already a participant
    const existingParticipant = session.participants.find(p => p.userId === userId);
    if (existingParticipant) {
      throw new BadRequestException(`User ${userId} is already a participant in this room`);
    }

    // BUSINESS RULE: Only users with status MATCHED can join rooms
    // Only users with _AVAILABLE statuses (AVAILABLE, IN_SQUAD_AVAILABLE, IN_BROADCAST_AVAILABLE) can become MATCHED
    // Users with IN_SQUAD or IN_BROADCAST cannot join (they're already in a call)
    // In TEST_MODE, skip status validation
    if (process.env.TEST_MODE !== "true") {
      try {
        const userStatus = await this.discoveryClient.getUserStatus(userId);

        // Explicitly reject users with IN_SQUAD or IN_BROADCAST status (they're already in a call)
        if (userStatus === "IN_SQUAD" || userStatus === "IN_BROADCAST") {
          throw new BadRequestException(
            `User ${userId} cannot join a room because they are already in an active call (status: ${userStatus}). ` +
            `Users must leave their current call before joining a new room.`
          );
        }

        if (userStatus !== "MATCHED") {
          throw new BadRequestException(
            `User ${userId} must be in MATCHED status to join a room. Current status: ${userStatus}. ` +
            `Valid statuses to become MATCHED: AVAILABLE, IN_SQUAD_AVAILABLE, IN_BROADCAST_AVAILABLE`
          );
        }
      } catch (error: any) {
        // If we can't check status (user-service unavailable), log warning but continue in TEST_MODE
        if (error instanceof BadRequestException) {
          throw error; // Re-throw validation errors
        }
        this.logger.warn(`Could not verify status for user ${userId}: ${error.message}`);
        // In production, we should fail if we can't verify status
        throw new BadRequestException(
          `Could not verify user status. Please ensure user-service is running and user is in MATCHED status.`
        );
      }
    } else {
      this.logger.log(`[TEST_MODE] Skipping user status validation for adding participant ${userId}`);
    }

    // Get user's previous status before joining
    // User is currently MATCHED, but we need to track what they were before MATCHED
    // For addParticipant flow, user likely came from discovery (AVAILABLE) or was in a squad (IN_SQUAD_AVAILABLE)
    // Default to AVAILABLE if we can't determine
    let previousStatus = "AVAILABLE";
    try {
      // Check if user was a viewer first (they might have come from waitlist or were viewing)
      const wasViewer = await this.prisma.callViewer.findFirst({
        where: {
          sessionId: session.id,
          userId,
          leftAt: null
        }
      });
      if (wasViewer) {
        previousStatus = "VIEWER";
      } else {
        // User likely came from discovery or was in a squad
        // Default to AVAILABLE (most common case)
        previousStatus = "AVAILABLE";
      }
    } catch (error) {
      // Default to AVAILABLE if we can't determine
      previousStatus = "AVAILABLE";
    }

    // Add to database
    await this.prisma.callParticipant.create({
      data: {
        sessionId: session.id,
        userId,
        role: "PARTICIPANT",
        status: "active",
        previousStatus
      }
    });

    await this.prisma.callEvent.create({
      data: {
        sessionId: session.id,
        eventType: "participant_joined",
        userId,
        metadata: JSON.stringify({ roomId })
      }
    });

    // Notify discovery-service of participant join
    this.discoveryClient.notifyParticipantJoined(roomId, userId).catch((err) => {
      this.logger.error(`Failed to notify discovery-service: ${err.message}`);
    });

    this.logger.log(`Participant ${userId} added to room ${roomId}`);
  }

  /**
   * Remove a participant from room
   */
  /**
   * Remove participant from database only (used when room not in memory)
   */
  async removeParticipantFromDatabase(roomId: string, userId: string): Promise<void> {
    // Update database directly without requiring in-memory room
    const session = await this.prisma.callSession.findUnique({
      where: { roomId }
    });

    if (!session) {
      this.logger.warn(`Cannot remove participant ${userId} from room ${roomId}: session not found`);
      return;
    }

    await this.prisma.callParticipant.updateMany({
      where: {
        sessionId: session.id,
        userId,
        status: "active",
        leftAt: null
      },
      data: {
        leftAt: new Date(),
        status: "left"
      }
    });

    // Check if room should be ended
    // BUSINESS RULE: Room ends only when no participants remain
    // Single user rooms are now allowed
    const activeParticipants = await this.prisma.callParticipant.findMany({
      where: {
        sessionId: session.id,
        status: "active",
        leftAt: null
      },
      select: { userId: true }
    });

    // If no active participants left, end the room
    if (activeParticipants.length === 0) {
      this.logger.log(`No active participants left in room ${roomId}, ending room`);
      await this.endRoom(roomId);
      return;
    }

    // Room continues (single user or multiple users) - only update leaving user's status.
    // Preserve AVAILABLE when another flow (e.g. raincheck) already moved user to discovery pool.
    let statusAfterLeave = "ONLINE";
    try {
      const currentStatus = await this.discoveryClient.getUserStatus(userId);
      if (currentStatus === "AVAILABLE") {
        statusAfterLeave = "AVAILABLE";
      }
    } catch (error: any) {
      this.logger.warn(`Failed to read current status for ${userId}, defaulting to ONLINE: ${error?.message || error}`);
    }
    this.discoveryClient.updateUserStatus(userId, statusAfterLeave).catch((err) => {
      this.logger.error(`Failed to update user ${userId} status to ${statusAfterLeave}: ${err.message}`);
    });

    this.logger.log(`Participant ${userId} removed from database for room ${roomId}, status updated to ${statusAfterLeave}`);
  }

  async removeParticipant(roomId: string, userId: string): Promise<void> {
    // Try to get room from memory, but continue even if not found (will update DB)
    let room: RoomState | null = null;
    let participant: ParticipantState | undefined;

    try {
      room = this.getRoom(roomId);
      participant = room.participants.get(userId);
    } catch (error) {
      // Room not in memory, but we can still update database
      this.logger.warn(`Room ${roomId} not in memory, will only update database for participant ${userId}`);
    }

    if (room && participant) {
      // Close transports and producers
      for (const t of participant.transports.values()) { try { t.close(); } catch { } }
      if (participant.producer.audio) {
        room.producerOwnerById.delete(participant.producer.audio.id);
        participant.producer.audio.close();
      }
      if (participant.producer.video) {
        room.producerOwnerById.delete(participant.producer.video.id);
        participant.producer.video.close();
      }

      // Close all consumers
      for (const consumer of participant.consumers.values()) {
        consumer.close();
      }

      room.participants.delete(userId);
    }

    // Update database
    const session = await this.prisma.callSession.findUnique({
      where: { roomId }
    });

    if (session) {
      // Update participant record - only update if currently active
      const updateResult = await this.prisma.callParticipant.updateMany({
        where: {
          sessionId: session.id,
          userId,
          status: "active", // Only update active participants
          leftAt: null // Only update participants who haven't left yet
        },
        data: {
          leftAt: new Date(),
          status: "left"
        }
      });

      if (updateResult.count === 0) {
        this.logger.warn(`No active participant record found to update for user ${userId} in room ${roomId}`);
        // User might already be marked as left, or might be a viewer instead
        return;
      }

      this.logger.log(`Updated ${updateResult.count} participant record(s) for user ${userId} in room ${roomId}`);

      await this.prisma.callEvent.create({
        data: {
          sessionId: session.id,
          eventType: "participant_left",
          userId,
          metadata: JSON.stringify({ roomId })
        }
      });

      // Check if room should be ended
      // BUSINESS RULE: Room ends only when no participants remain
      // Single user rooms are now allowed
      const activeParticipants = await this.prisma.callParticipant.findMany({
        where: {
          sessionId: session.id,
          status: "active",
          leftAt: null
        },
        select: { userId: true }
      });

      // If no active participants left, end the room
      if (activeParticipants.length === 0) {
        this.logger.log(`No active participants left in room ${roomId}, ending room`);
        await this.endRoom(roomId);
        return; // endRoom will handle status updates
      }

      // Room continues (single user or multiple users) - only update leaving user's status
    }

    // Preserve AVAILABLE when another flow (e.g. raincheck) already moved user to discovery pool.
    let statusAfterLeave = "ONLINE";
    try {
      const currentStatus = await this.discoveryClient.getUserStatus(userId);
      if (currentStatus === "AVAILABLE") {
        statusAfterLeave = "AVAILABLE";
      }
    } catch (error: any) {
      this.logger.warn(`Failed to read current status for ${userId}, defaulting to ONLINE: ${error?.message || error}`);
    }
    this.discoveryClient.updateUserStatus(userId, statusAfterLeave).catch((err) => {
      this.logger.error(`Failed to update user ${userId} status to ${statusAfterLeave}: ${err.message}`);
    });

    this.logger.log(`Participant ${userId} removed from room ${roomId}, status updated to ${statusAfterLeave}`);
  }

  /**
   * Kick a participant from the room (HOST only)
   */
  async kickUser(roomId: string, kickerUserId: string, targetUserId: string): Promise<void> {
    // Validate that kicker can kick the target
    const canKick = await this.canKickUser(roomId, kickerUserId, targetUserId);
    if (!canKick) {
      throw new BadRequestException(
        `User ${kickerUserId} cannot kick ${targetUserId}. Only HOSTs can kick PARTICIPANTs.`
      );
    }

    // Log the kick event
    const session = await this.prisma.callSession.findUnique({
      where: { roomId }
    });

    if (session) {
      await this.prisma.callEvent.create({
        data: {
          sessionId: session.id,
          eventType: "participant_kicked",
          userId: kickerUserId,
          metadata: JSON.stringify({
            kickedUserId: targetUserId,
            kickedBy: kickerUserId
          })
        }
      });
    }

    // Remove the participant (this handles all cleanup)
    await this.removeParticipant(roomId, targetUserId);

    this.logger.log(`User ${targetUserId} was kicked from room ${roomId} by HOST ${kickerUserId}`);
  }

  /**
   * Enable broadcasting mode (HOST only)
   */
  async enableBroadcasting(roomId: string, userId: string): Promise<void> {
    // Validate user is a HOST
    const isUserHost = await this.isHost(roomId, userId);
    if (!isUserHost) {
      throw new BadRequestException(
        `User ${userId} is not a HOST. Only HOSTs can enable broadcasting.`
      );
    }

    // Ensure room is in memory (will reload if needed)
    const roomExists = await this.roomExists(roomId);
    if (!roomExists) {
      throw new NotFoundException(`Room ${roomId} not found`);
    }

    const room = this.getRoom(roomId); // Safe to call now since roomExists ensures it's in memory
    const session = await this.prisma.callSession.findUnique({
      where: { roomId }
    });

    if (!session) {
      throw new NotFoundException(`Session for room ${roomId} not found`);
    }

    // Check broadcasting status from database (source of truth)
    if (session.isBroadcasting) {
      // Already broadcasting, update in-memory state if needed
      room.isBroadcasting = true;
      return; // No need to do anything else
    }

    // Update in-memory state first (will be persisted to DB below)
    room.isBroadcasting = true;

    // Update database
    await this.prisma.callSession.update({
      where: { id: session.id },
      data: {
        status: "IN_BROADCAST",
        isBroadcasting: true
      }
    });

    await this.prisma.callEvent.create({
      data: {
        sessionId: session.id,
        eventType: "broadcast_started",
        metadata: JSON.stringify({ roomId })
      }
    });

    // Notify discovery-service that broadcasting started
    const participants = await this.prisma.callParticipant.findMany({
      where: { sessionId: session.id },
      select: { userId: true }
    });
    const participantUserIds = participants.map((p) => p.userId);
    this.discoveryClient.notifyBroadcastStarted(roomId, participantUserIds).catch((err) => {
      this.logger.error(`Failed to notify discovery-service: ${err.message}`);
    });

    // BUSINESS RULE: When broadcast starts, participant status changes to IN_BROADCAST
    // Update user statuses from IN_SQUAD → IN_BROADCAST
    this.discoveryClient.updateUserStatuses(participantUserIds, "IN_BROADCAST").catch((err) => {
      this.logger.error(`Failed to update user statuses: ${err.message}`);
    });

    this.logger.log(`Broadcasting enabled for room ${roomId} by HOST ${userId}`);
  }

  /**
   * Disable broadcasting mode (HOST only) - Returns to IN_SQUAD
   */
  async disableBroadcasting(roomId: string, userId: string): Promise<void> {
    // Validate user is a HOST
    const isUserHost = await this.isHost(roomId, userId);
    if (!isUserHost) {
      throw new BadRequestException(
        `User ${userId} is not a HOST. Only HOSTs can disable broadcasting.`
      );
    }

    // Ensure room is in memory (will reload if needed)
    const roomExists = await this.roomExists(roomId);
    if (!roomExists) {
      throw new NotFoundException(`Room ${roomId} not found`);
    }

    const room = this.getRoom(roomId);
    const session = await this.prisma.callSession.findUnique({
      where: { roomId }
    });

    if (!session) {
      throw new NotFoundException(`Session for room ${roomId} not found`);
    }

    // Check if already not broadcasting
    if (!session.isBroadcasting) {
      // Already not broadcasting, update in-memory state if needed
      room.isBroadcasting = false;
      return; // No need to do anything else
    }

    // Update in-memory state
    room.isBroadcasting = false;

    // Get all active participants before updating
    const participants = await this.prisma.callParticipant.findMany({
      where: {
        sessionId: session.id,
        status: "active",
        leftAt: null
      },
      select: { userId: true }
    });
    const participantUserIds = participants.map((p) => p.userId);

    // Update database
    await this.prisma.callSession.update({
      where: { id: session.id },
      data: {
        status: "IN_SQUAD",
        isBroadcasting: false
      }
    });

    // Log event
    await this.prisma.callEvent.create({
      data: {
        sessionId: session.id,
        eventType: "broadcast_stopped",
        userId,
        metadata: JSON.stringify({ roomId, stoppedBy: userId })
      }
    });

    // BUSINESS RULE: When broadcast stops, participant status changes back to IN_SQUAD
    // Update user statuses from IN_BROADCAST → IN_SQUAD
    this.discoveryClient.updateUserStatuses(participantUserIds, "IN_SQUAD").catch((err) => {
      this.logger.error(`Failed to update user statuses: ${err.message}`);
    });

    // Remove all viewers when broadcast stops
    await this.prisma.callViewer.updateMany({
      where: {
        sessionId: session.id,
        leftAt: null
      },
      data: {
        leftAt: new Date()
      }
    });

    // Update viewer statuses to OFFLINE
    const viewers = await this.prisma.callViewer.findMany({
      where: {
        sessionId: session.id,
        leftAt: { not: null }
      },
      select: { userId: true }
    });
    const viewerUserIds = viewers.map(v => v.userId);
    if (viewerUserIds.length > 0) {
      this.discoveryClient.updateUserStatuses(viewerUserIds, "OFFLINE").catch((err) => {
        this.logger.error(`Failed to update viewer statuses: ${err.message}`);
      });
    }

    this.logger.log(`Broadcasting disabled for room ${roomId} by HOST ${userId} - returning to IN_SQUAD`);
  }

  /**
   * Enable pull stranger mode for a room (HOST only)
   * Updates all participants to IN_SQUAD_AVAILABLE status
   * Only users with _AVAILABLE statuses can be shown in face cards and matched
   */
  async enablePullStranger(roomId: string, userId: string): Promise<void> {
    // Verify room exists
    const session = await this.prisma.callSession.findUnique({
      where: { roomId },
      include: {
        participants: {
          where: {
            status: "active",
            leftAt: null
          }
        }
      }
    });

    if (!session) {
      throw new NotFoundException(`Room ${roomId} not found`);
    }

    // Verify user is HOST
    const isUserHost = await this.isHost(roomId, userId);
    if (!isUserHost) {
      throw new BadRequestException(`Only HOST can enable pull stranger mode`);
    }

    // Check if room is full
    if (session.participants.length >= this.maxParticipants) {
      throw new BadRequestException(
        `Room is full (${session.participants.length}/${this.maxParticipants} participants). Cannot enable pull stranger mode.`
      );
    }

    // Check if room is already in pull stranger mode
    if (session.pullStrangerEnabled) {
      throw new BadRequestException(
        `Pull stranger mode is already enabled. Wait for a stranger to join before enabling again.`
      );
    }

    // Update database: enable pull stranger mode
    await this.prisma.callSession.update({
      where: { id: session.id },
      data: { pullStrangerEnabled: true }
    });

    // Product rule: only the HOST who clicked "pull stranger" should appear in discovery.
    // Force-sync all active participants to avoid stale statuses:
    // - enabled host => IN_SQUAD_AVAILABLE
    // - everyone else => IN_SQUAD
    const participantUserIds = session.participants.map((p) => p.userId);
    for (const participantId of participantUserIds) {
      const targetStatus = participantId === userId ? "IN_SQUAD_AVAILABLE" : "IN_SQUAD";
      await this.discoveryClient.updateUserStatus(participantId, targetStatus);
    }

    // Log event
    await this.prisma.callEvent.create({
      data: {
        sessionId: session.id,
        eventType: "pull_stranger_enabled",
        userId: userId,
        metadata: JSON.stringify({
          enabledBy: userId,
          participantCount: session.participants.length,
          visibleInDiscoveryUserId: userId,
          windowMs: this.pullStrangerWindowMs
        })
      }
    });

    // Automatically end pull mode after configured window if no one joins.
    this.schedulePullStrangerExpiry(roomId, userId);

    this.logger.log(
      `Pull stranger mode enabled for room ${roomId} by HOST ${userId}. ` +
      `Status sync complete: host=${userId}->IN_SQUAD_AVAILABLE, others->IN_SQUAD`
    );
  }

  /**
   * Join room via pull stranger (one-way acceptance)
   * C accepts A's card → C joins room directly (no match record needed)
   * Uses transaction with Serializable isolation to prevent race conditions
   * (e.g., C sees A and E sees B, both accept simultaneously - only one succeeds)
   */
  async joinViaPullStranger(
    roomId: string,
    joiningUserId: string,
    targetUserId: string
  ): Promise<{ roomId: string; sessionId: string }> {
    return this.prisma.$transaction(async (tx) => {
      // Get room with lock to prevent concurrent joins
      const session = await tx.callSession.findUnique({
        where: { roomId },
        include: {
          participants: {
            where: {
              status: "active",
              leftAt: null
            }
          }
        }
      });

      if (!session) {
        throw new NotFoundException(`Room ${roomId} not found`);
      }

      // Verify pull stranger mode is enabled
      if (!session.pullStrangerEnabled) {
        throw new BadRequestException(
          `Pull stranger mode is not enabled for this room. A HOST must enable it first.`
        );
      }

      // Pull mode has a fixed window. If expired, disable it and restore initiator.
      const latestEnableEvent = await tx.callEvent.findFirst({
        where: {
          sessionId: session.id,
          eventType: "pull_stranger_enabled"
        },
        orderBy: {
          createdAt: "desc"
        },
        select: {
          createdAt: true,
          userId: true
        }
      });

      if (latestEnableEvent) {
        const expiresAt = latestEnableEvent.createdAt.getTime() + this.pullStrangerWindowMs;
        if (Date.now() > expiresAt) {
          await tx.callSession.update({
            where: { id: session.id },
            data: { pullStrangerEnabled: false }
          });
          this.clearPullStrangerExpiryTimer(roomId);

          if (latestEnableEvent.userId) {
            this.discoveryClient.updateUserStatus(latestEnableEvent.userId, "IN_SQUAD").catch((err) => {
              this.logger.error(`Failed to restore expired pull-stranger host ${latestEnableEvent.userId}: ${err.message}`);
            });
          }

          throw new BadRequestException(
            `Pull stranger window has expired. Host needs to enable it again.`
          );
        }
      }

      // Verify target user is in the room
      const targetParticipant = session.participants.find(p => p.userId === targetUserId);
      if (!targetParticipant) {
        throw new BadRequestException(
          `Target user ${targetUserId} is not a participant in room ${roomId}`
        );
      }

      // Verify target user has pull-stranger compatible status.
      // MATCHED can appear transiently when discovery card rendering creates/refreshes matches.
      if (process.env.TEST_MODE !== "true") {
        try {
          const targetUserStatus = await this.discoveryClient.getUserStatus(targetUserId);
          // Allow IN_SQUAD as a transient fallback if user-service update is slightly delayed.
          if (
            targetUserStatus !== "IN_SQUAD_AVAILABLE" &&
            targetUserStatus !== "IN_SQUAD" &&
            targetUserStatus !== "MATCHED"
          ) {
            throw new BadRequestException(
              `Target user ${targetUserId} does not have IN_SQUAD_AVAILABLE/IN_SQUAD/MATCHED status (current: ${targetUserStatus}). ` +
              `They may have already been matched or their status changed.`
            );
          }
        } catch (error: any) {
          if (error instanceof BadRequestException) {
            throw error;
          }
          this.logger.warn(`Could not verify target user status: ${error.message}`);
          throw new BadRequestException(
            `Could not verify target user status. Please ensure user-service is running.`
          );
        }
      }

      // Check room capacity
      if (session.participants.length >= this.maxParticipants) {
        throw new BadRequestException(
          `Room is full (${session.participants.length}/${this.maxParticipants} participants). Cannot join.`
        );
      }

      // Verify joining user is not already in the room
      const existingParticipant = session.participants.find(p => p.userId === joiningUserId);
      if (existingParticipant) {
        throw new BadRequestException(`User ${joiningUserId} is already a participant in this room`);
      }

      // Verify joining user has an _AVAILABLE status or MATCHED.
      // MATCHED is valid here because discovery card rendering can temporarily transition
      // a user to MATCHED before they click "meet this person rn".
      if (process.env.TEST_MODE !== "true") {
        try {
          const joiningUserStatus = await this.discoveryClient.getUserStatus(joiningUserId);
          const allowedJoiningStatuses = new Set(["AVAILABLE", "IN_SQUAD_AVAILABLE", "IN_BROADCAST_AVAILABLE", "MATCHED"]);
          if (!allowedJoiningStatuses.has(joiningUserStatus)) {
            // Explicitly reject IN_SQUAD/IN_BROADCAST
            if (joiningUserStatus === "IN_SQUAD" || joiningUserStatus === "IN_BROADCAST") {
              throw new BadRequestException(
                `User ${joiningUserId} cannot join because they are already in an active call (status: ${joiningUserStatus}). ` +
                `Users must leave their current call before joining a new room.`
              );
            }
            throw new BadRequestException(
              `User ${joiningUserId} must be in AVAILABLE, IN_SQUAD_AVAILABLE, IN_BROADCAST_AVAILABLE, or MATCHED status to join via pull stranger. ` +
              `Current status: ${joiningUserStatus}. Only users with _AVAILABLE statuses can join.`
            );
          }
        } catch (error: any) {
          if (error instanceof BadRequestException) {
            throw error;
          }
          this.logger.warn(`Could not verify joining user status: ${error.message}`);
          throw new BadRequestException(
            `Could not verify joining user status. Please ensure user-service is running.`
          );
        }
      }

      // Get joining user's previous status
      // For pull stranger flow, user likely came from discovery (AVAILABLE) or was in a squad (IN_SQUAD_AVAILABLE)
      // Check if they were in a squad first
      let previousStatus = "AVAILABLE";
      try {
        // Check if user was in a squad (IN_SQUAD_AVAILABLE status)
        const userStatus = await this.discoveryClient.getUserStatus(joiningUserId);
        if (userStatus === "IN_SQUAD_AVAILABLE") {
          previousStatus = "IN_SQUAD_AVAILABLE";
        } else if (userStatus === "IN_BROADCAST_AVAILABLE") {
          previousStatus = "IN_BROADCAST_AVAILABLE";
        } else {
          // Default to AVAILABLE (most common case - coming from discovery)
          previousStatus = "AVAILABLE";
        }
      } catch (error) {
        // Default to AVAILABLE if we can't determine
        previousStatus = "AVAILABLE";
      }

      // Add joining user to room
      await tx.callParticipant.create({
        data: {
          sessionId: session.id,
          userId: joiningUserId,
          role: "PARTICIPANT",
          status: "active",
          previousStatus
        }
      });

      // Disable pull stranger mode (only 1 person can join per enable)
      await tx.callSession.update({
        where: { id: session.id },
        data: { pullStrangerEnabled: false }
      });
      this.clearPullStrangerExpiryTimer(roomId);

      // Get all participant user IDs (including new joiner)
      const allParticipantUserIds = [...session.participants.map(p => p.userId), joiningUserId];

      // Determine status to restore based on room's broadcasting state
      const statusToRestore = session.isBroadcasting ? "IN_BROADCAST" : "IN_SQUAD";

      // Update all participants (including new joiner) to restored status
      this.discoveryClient.updateUserStatuses(allParticipantUserIds, statusToRestore).catch((err) => {
        this.logger.error(`Failed to update user statuses to ${statusToRestore}: ${err.message}`);
      });

      // Log event
      await tx.callEvent.create({
        data: {
          sessionId: session.id,
          eventType: "participant_joined_via_pull_stranger",
          userId: joiningUserId,
          metadata: JSON.stringify({
            joiningUserId,
            targetUserId,
            participantCount: allParticipantUserIds.length,
            restoredStatus: statusToRestore
          })
        }
      });

      // Update in-memory room state if it exists
      try {
        const room = this.getRoom(roomId);
        // Note: Participant state will be created when user connects via WebSocket
        // For now, just mark that they're a participant in the room
        if (!room.participants.has(joiningUserId)) {
          // Participant state will be initialized when they connect via WebSocket
          // We just need to ensure the room knows about them
          this.logger.debug(`Room ${roomId} in memory - participant ${joiningUserId} will be initialized on WebSocket connect`);
        }
      } catch (error) {
        // Room not in memory, that's okay
        this.logger.debug(`Room ${roomId} not in memory, skipping in-memory update`);
      }

      this.logger.log(
        `User ${joiningUserId} joined room ${roomId} via pull stranger (target: ${targetUserId}). ` +
        `All participants restored to ${statusToRestore} status. Pull stranger mode disabled.`
      );

      return { roomId, sessionId: session.id };
    }, {
      isolationLevel: "Serializable", // Highest isolation to prevent concurrent joins (race condition protection)
      timeout: 10000 // 10 seconds timeout
    });
  }

  /**
   * Get room ID for a user with IN_SQUAD_AVAILABLE status (for discovery service)
   * Returns roomId if user is in a room with pull stranger enabled
   */
  async getRoomForPullStrangerUser(userId: string): Promise<string | null> {
    const session = await this.prisma.callSession.findFirst({
      where: {
        pullStrangerEnabled: true,
        status: { in: ["IN_SQUAD", "IN_BROADCAST"] },
        participants: {
          some: {
            userId: userId,
            status: "active",
            leftAt: null
          }
        }
      },
      select: { roomId: true }
    });

    return session?.roomId || null;
  }

  /**
   * Request to join broadcast (viewer clicks "Join" button)
   * Adds user to waitlist and updates status to MATCHED
   */
  async requestToJoin(roomId: string, userId: string): Promise<void> {
    // Ensure room exists
    const session = await this.prisma.callSession.findUnique({
      where: { roomId },
      include: {
        participants: {
          where: {
            status: "active",
            leftAt: null
          }
        }
      }
    });

    if (!session) {
      throw new NotFoundException(`Room ${roomId} not found`);
    }

    // Verify broadcast is active
    if (!session.isBroadcasting) {
      throw new BadRequestException("Room is not broadcasting");
    }

    // Verify user is currently a viewer
    const viewer = await this.prisma.callViewer.findFirst({
      where: {
        sessionId: session.id,
        userId,
        leftAt: null
      }
    });

    if (!viewer) {
      throw new BadRequestException(`User ${userId} is not a viewer of this broadcast`);
    }

    // Check if user already has pending request
    const existingRequest = await this.prisma.callWaitlist.findFirst({
      where: {
        sessionId: session.id,
        userId,
        status: "pending"
      }
    });

    if (existingRequest) {
      throw new BadRequestException(`User ${userId} already has a pending join request`);
    }

    // Check room capacity
    if (session.participants.length >= this.maxParticipants) {
      throw new BadRequestException(
        `Room is full (${session.participants.length}/${this.maxParticipants} participants). Cannot add to waitlist.`
      );
    }

    // Create waitlist entry
    await this.prisma.callWaitlist.create({
      data: {
        sessionId: session.id,
        userId,
        status: "pending"
      }
    });

    // Update user status: VIEWER → MATCHED
    await this.discoveryClient.updateUserStatus(userId, "MATCHED").catch((err) => {
      this.logger.error(`Failed to update user ${userId} status to MATCHED: ${err.message}`);
    });

    // Log event
    await this.prisma.callEvent.create({
      data: {
        sessionId: session.id,
        eventType: "waitlist_requested",
        userId,
        metadata: JSON.stringify({ roomId })
      }
    });

    this.logger.log(`User ${userId} requested to join room ${roomId}, added to waitlist`);
  }

  /**
   * Cancel join request (viewer cancels their request)
   * Removes from waitlist and updates status back to VIEWER
   */
  async cancelJoinRequest(roomId: string, userId: string): Promise<void> {
    const session = await this.prisma.callSession.findUnique({
      where: { roomId }
    });

    if (!session) {
      throw new NotFoundException(`Room ${roomId} not found`);
    }

    // Verify user has pending request
    const waitlistEntry = await this.prisma.callWaitlist.findFirst({
      where: {
        sessionId: session.id,
        userId,
        status: "pending"
      }
    });

    if (!waitlistEntry) {
      throw new BadRequestException(`User ${userId} does not have a pending join request`);
    }

    // Update waitlist entry: status = "cancelled"
    await this.prisma.callWaitlist.update({
      where: { id: waitlistEntry.id },
      data: { status: "cancelled" }
    });

    // Update user status: MATCHED → VIEWER
    await this.discoveryClient.updateUserStatus(userId, "VIEWER").catch((err) => {
      this.logger.error(`Failed to update user ${userId} status to VIEWER: ${err.message}`);
    });

    // Log event
    await this.prisma.callEvent.create({
      data: {
        sessionId: session.id,
        eventType: "waitlist_cancelled",
        userId,
        metadata: JSON.stringify({ roomId })
      }
    });

    this.logger.log(`User ${userId} cancelled join request for room ${roomId}`);
  }

  /**
   * Get waitlist for a room (hosts can see who requested to join)
   */
  async getWaitlist(roomId: string): Promise<Array<{
    userId: string;
    requestedAt: Date;
    username?: string | null;
    displayPictureUrl?: string | null;
  }>> {
    const session = await this.prisma.callSession.findUnique({
      where: { roomId },
      include: {
        waitlist: {
          where: {
            status: "pending"
          },
          orderBy: {
            requestedAt: "asc" // Oldest first (first-come-first-served)
          }
        }
      }
    });

    if (!session) {
      throw new NotFoundException(`Room ${roomId} not found`);
    }

    // Extract userIds from waitlist entries
    const userIds = session.waitlist.map(w => w.userId);

    if (userIds.length === 0) {
      return [];
    }

    // Fetch user profiles in batch (reuse existing method)
    const profiles = await this.discoveryClient.getUserProfilesBatch(userIds);

    // Map profiles to waitlist entries
    return session.waitlist.map(waitlistEntry => {
      const profile = profiles.get(waitlistEntry.userId);
      return {
        userId: waitlistEntry.userId,
        requestedAt: waitlistEntry.requestedAt,
        username: profile?.username || null,
        displayPictureUrl: profile?.displayPictureUrl || null
      };
    });
  }

  /**
   * Accept user from waitlist (host adds viewer to call)
   * Reuses addParticipant logic
   */
  async acceptFromWaitlist(roomId: string, hostUserId: string, targetUserId: string): Promise<void> {
    // Verify hostUserId is a HOST
    const isUserHost = await this.isHost(roomId, hostUserId);
    if (!isUserHost) {
      throw new BadRequestException(
        `User ${hostUserId} is not a HOST. Only HOSTs can accept users from waitlist.`
      );
    }

    const session = await this.prisma.callSession.findUnique({
      where: { roomId },
      include: {
        participants: {
          where: {
            status: "active",
            leftAt: null
          }
        }
      }
    });

    if (!session) {
      throw new NotFoundException(`Room ${roomId} not found`);
    }

    // Verify targetUserId has pending waitlist request
    const waitlistEntry = await this.prisma.callWaitlist.findFirst({
      where: {
        sessionId: session.id,
        userId: targetUserId,
        status: "pending"
      }
    });

    if (!waitlistEntry) {
      throw new BadRequestException(
        `User ${targetUserId} does not have a pending join request for this room`
      );
    }

    // Verify targetUserId is still a viewer (hasn't scrolled away)
    const viewer = await this.prisma.callViewer.findFirst({
      where: {
        sessionId: session.id,
        userId: targetUserId,
        leftAt: null
      }
    });

    if (!viewer) {
      throw new BadRequestException(
        `User ${targetUserId} is no longer viewing this broadcast. They may have left.`
      );
    }

    // Verify room has capacity
    if (session.participants.length >= this.maxParticipants) {
      throw new BadRequestException(
        `Room is full (${session.participants.length}/${this.maxParticipants} participants). Cannot add more participants.`
      );
    }

    // Verify target is not already a participant
    const existingParticipant = session.participants.find(p => p.userId === targetUserId);
    if (existingParticipant) {
      throw new BadRequestException(`User ${targetUserId} is already a participant in this room`);
    }

    // Use transaction to ensure atomicity
    await this.prisma.$transaction(async (tx) => {
      // Remove from waitlist (mark as "accepted")
      await tx.callWaitlist.update({
        where: { id: waitlistEntry.id },
        data: { status: "accepted" }
      });

      // Remove from viewers (if still viewing)
      await tx.callViewer.updateMany({
        where: {
          sessionId: session.id,
          userId: targetUserId,
          leftAt: null
        },
        data: {
          leftAt: new Date()
        }
      });

      // Add as PARTICIPANT with previousStatus = "VIEWER" since they came from waitlist
      await tx.callParticipant.create({
        data: {
          sessionId: session.id,
          userId: targetUserId,
          role: "PARTICIPANT",
          status: "active",
          previousStatus: "VIEWER"
        }
      });

      // Log event
      await tx.callEvent.create({
        data: {
          sessionId: session.id,
          eventType: "participant_joined_via_waitlist",
          userId: targetUserId,
          metadata: JSON.stringify({
            roomId,
            acceptedBy: hostUserId,
            previousStatus: "VIEWER"
          })
        }
      });
    });

    // Determine status to set based on room's broadcasting state
    const statusToSet = session.isBroadcasting ? "IN_BROADCAST" : "IN_SQUAD";

    // Update user status: MATCHED → IN_BROADCAST or IN_SQUAD
    await this.discoveryClient.updateUserStatus(targetUserId, statusToSet).catch((err) => {
      this.logger.error(`Failed to update user ${targetUserId} status to ${statusToSet}: ${err.message}`);
    });

    // Notify discovery-service of participant join
    this.discoveryClient.notifyParticipantJoined(roomId, targetUserId).catch((err) => {
      this.logger.error(`Failed to notify discovery-service: ${err.message}`);
    });

    this.logger.log(
      `User ${targetUserId} accepted from waitlist and added to room ${roomId} as PARTICIPANT by HOST ${hostUserId}. Status: MATCHED → ${statusToSet}`
    );
  }

  /**
   * Add a viewer to the broadcast
   */
  async addViewer(roomId: string, userId: string): Promise<void> {
    // Ensure room is in memory (will reload if needed)
    const roomExists = await this.roomExists(roomId);
    if (!roomExists) {
      throw new NotFoundException(`Room ${roomId} not found`);
    }

    const room = this.getRoom(roomId); // Safe to call now since roomExists ensures it's in memory
    const session = await this.prisma.callSession.findUnique({
      where: { roomId }
    });

    if (!session) {
      throw new NotFoundException(`Session for room ${roomId} not found`);
    }

    // Check broadcasting status from database (source of truth)
    if (!session.isBroadcasting) {
      throw new BadRequestException("Room is not broadcasting");
    }

    // Check if user is already a viewer (check both memory and database)
    if (room.viewers.has(userId)) {
      throw new BadRequestException(`User ${userId} is already a viewer`);
    }

    // Also check database
    const existingViewer = await this.prisma.callViewer.findFirst({
      where: {
        sessionId: session.id,
        userId,
        leftAt: null
      }
    });

    if (existingViewer) {
      throw new BadRequestException(`User ${userId} is already a viewer in this room`);
    }

    // Add to database
    await this.prisma.callViewer.create({
      data: {
        sessionId: session.id,
        userId
      }
    });

    this.logger.log(`Viewer ${userId} added to room ${roomId}`);
  }

  /**
   * Remove a viewer from the broadcast
   * @param leavingHMMTV - true if user is leaving HMM_TV section entirely (going to homepage), false if just scrolling to next broadcast
   */
  async removeViewer(roomId: string, userId: string, leavingHMMTV: boolean = false): Promise<void> {
    // Try to get room from memory, but continue even if not found (will update DB)
    let room: RoomState | null = null;
    let viewer: ViewerState | undefined;

    try {
      room = this.getRoom(roomId);
      viewer = room.viewers.get(userId);
    } catch (error) {
      // Room not in memory, but we can still update database
      this.logger.warn(`Room ${roomId} not in memory, will only update database for viewer ${userId}`);
    }

    if (room && viewer) {
      // Close transport (with error handling)
      try {
        if (viewer.transport) {
          viewer.transport.close();
          this.logger.log(`Closed transport for viewer ${userId} in room ${roomId}`);
        }
      } catch (error: any) {
        this.logger.warn(`Error closing transport for viewer ${userId}: ${error.message}`);
      }

      // Close all consumers (with error handling)
      for (const [producerId, consumer] of viewer.consumers.entries()) {
        try {
          consumer.close();
          this.logger.log(`Closed consumer ${producerId} for viewer ${userId} in room ${roomId}`);
        } catch (error: any) {
          this.logger.warn(`Error closing consumer ${producerId} for viewer ${userId}: ${error.message}`);
        }
      }

      room.viewers.delete(userId);
      this.logger.log(`Removed viewer ${userId} from room ${roomId} in-memory state`);
    }

    // Update database
    const session = await this.prisma.callSession.findUnique({
      where: { roomId }
    });

    if (!session) {
      this.logger.warn(`Cannot remove viewer ${userId} from room ${roomId}: session not found`);
      throw new NotFoundException(`Room ${roomId} not found`);
    }

    // Update viewer record - only if they haven't left already
    try {
      const updateResult = await this.prisma.callViewer.updateMany({
        where: {
          sessionId: session.id,
          userId,
          leftAt: null // Only update active viewers
        },
        data: {
          leftAt: new Date()
        }
      });

      if (updateResult.count === 0) {
        // Viewer might already be marked as left, or might not exist
        this.logger.warn(`No active viewer record found to update for user ${userId} in room ${roomId}. They may have already left or not be a viewer.`);
        // Don't throw error - just log and continue
      } else {
        this.logger.log(`✅ Successfully updated ${updateResult.count} viewer record(s) for user ${userId} in room ${roomId}. leftAt set to ${new Date().toISOString()}`);
      }
    } catch (error: any) {
      this.logger.error(`❌ Failed to update viewer record for user ${userId} in room ${roomId}: ${error.message}`);
      this.logger.error(`Error details: ${JSON.stringify(error)}`);
      throw error; // Re-throw so caller knows update failed
    }

    // Check if user is on waitlist
    const waitlistEntry = await this.prisma.callWaitlist.findFirst({
      where: {
        sessionId: session.id,
        userId,
        status: "pending"
      }
    });

    // Check if user is anonymous
    const isAnonymous = userId.startsWith('anonymous:');

    if (waitlistEntry) {
      // Remove from waitlist (mark as "cancelled")
      await this.prisma.callWaitlist.update({
        where: { id: waitlistEntry.id },
        data: { status: "cancelled" }
      });

      // Update status: MATCHED → VIEWER (user still in HMM_TV, just scrolled to different broadcast)
      // Skip status update for anonymous users
      if (!isAnonymous) {
        this.discoveryClient.updateUserStatus(userId, "VIEWER").catch((err) => {
          this.logger.error(`Failed to update user ${userId} status to VIEWER: ${err.message}`);
        });
        this.logger.log(`Viewer ${userId} removed from room ${roomId} and waitlist, status: MATCHED → VIEWER`);
      } else {
        this.logger.log(`Anonymous viewer ${userId} removed from room ${roomId} and waitlist`);
      }
    } else {
      // Not on waitlist - handle status based on context
      if (leavingHMMTV && !isAnonymous) {
        // Only update status for authenticated users
        // User leaving HMM_TV section entirely → ONLINE
        this.discoveryClient.updateUserStatus(userId, "ONLINE").catch((err) => {
          this.logger.error(`Failed to update user ${userId} status to ONLINE: ${err.message}`);
        });
        this.logger.log(`Viewer ${userId} removed from room ${roomId}, status: VIEWER → ONLINE (leaving HMM_TV)`);
      } else if (!isAnonymous) {
        // User still in HMM_TV, just scrolling to next broadcast → keep VIEWER
        // Status remains VIEWER (no change needed)
        this.logger.log(`Viewer ${userId} removed from room ${roomId}, status remains VIEWER (still in HMM_TV)`);
      } else {
        // Anonymous user - no status update needed
        this.logger.log(`Anonymous viewer ${userId} removed from room ${roomId}`);
      }
    }
  }

  /**
   * End a call/room
   * Handles ending room gracefully even if not in memory
   */
  async endRoom(roomId: string): Promise<void> {
    this.clearPullStrangerExpiryTimer(roomId);

    // Try to get room from memory, but continue even if not found (will update DB)
    let room: RoomState | null = null;
    try {
      room = this.getRoom(roomId);
    } catch (error) {
      this.logger.warn(`Room ${roomId} not in memory, will only update database when ending room`);
    }

    const session = await this.prisma.callSession.findUnique({
      where: { roomId }
    });

    if (!session) {
      this.logger.warn(`Cannot end room ${roomId}: session not found in database`);
      return;
    }

    // Close all transports and producers/consumers if room is in memory
    if (room) {
      for (const participant of room.participants.values()) {
        for (const t of participant.transports.values()) { try { t.close(); } catch { } }
        if (participant.producer.audio) participant.producer.audio.close();
        if (participant.producer.video) participant.producer.video.close();
        for (const consumer of participant.consumers.values()) {
          consumer.close();
        }
      }

      for (const viewer of room.viewers.values()) {
        viewer.transport.close();
        for (const consumer of viewer.consumers.values()) {
          consumer.close();
        }
      }

      // Close router
      room.router.close();

      // Remove from memory
      this.rooms.delete(roomId);
    }

    // Update database - stop broadcasting if active (room ending stops broadcast)
    await this.prisma.callSession.update({
      where: { id: session.id },
      data: {
        status: "ENDED",
        isBroadcasting: false, // Stop broadcasting when room ends
        endedAt: new Date()
      }
    });

    // Log broadcast stop if it was active
    if (session.isBroadcasting) {
      this.logger.log(`Broadcasting stopped automatically due to room ending: ${roomId}`);
      try {
        await this.prisma.callEvent.create({
          data: {
            sessionId: session.id,
            eventType: "broadcast_stopped",
            metadata: JSON.stringify({ roomId, reason: "room_ended" })
          }
        });
      } catch (error: any) {
        this.logger.warn(`Failed to create broadcast_stopped event: ${error?.message || error}`);
        // Continue - event logging is not critical
      }
    }

    try {
      await this.prisma.callEvent.create({
        data: {
          sessionId: session.id,
          eventType: "call_ended",
          metadata: JSON.stringify({ roomId })
        }
      });
    } catch (error: any) {
      this.logger.warn(`Failed to create call_ended event: ${error?.message || error}`);
      // Continue - event logging is not critical
    }

    // Get all user IDs (active participants + active viewers) at time of room end
    // This includes any remaining participants and the user who just left
    const participants = await this.prisma.callParticipant.findMany({
      where: {
        sessionId: session.id,
        // Include both active and just-left participants to update all their statuses
      },
      select: { userId: true, previousStatus: true }
    });
    const viewers = await this.prisma.callViewer.findMany({
      where: {
        sessionId: session.id,
        leftAt: null // Only active viewers
      },
      select: { userId: true }
    });

    // Get all pending waitlist entries
    const waitlistEntries = await this.prisma.callWaitlist.findMany({
      where: {
        sessionId: session.id,
        status: "pending"
      },
      select: { userId: true }
    });

    const participantUserIds = participants.map((p: any) => p.userId);
    const viewerUserIds = viewers.map((v: any) => v.userId);
    const waitlistUserIds = waitlistEntries.map((w: any) => w.userId);

    // Cleanup pending dares: Mark sent/done dares as cancelled if not fully paid
    // This prevents stuck dares where room ends but payment wasn't completed
    const pendingDares = await this.prisma.callDare.findMany({
      where: {
        sessionId: session.id,
        status: {
          in: ["sent", "done"] // Dares that are sent but not fully confirmed
        },
        secondPaymentSent: false // Not fully paid
      }
    });

    if (pendingDares.length > 0) {
      this.logger.log(
        `Room ${roomId} ending: ${pendingDares.length} pending dares found. ` +
        `Marking as cancelled (full payment not completed).`
      );

      await this.prisma.callDare.updateMany({
        where: {
          sessionId: session.id,
          status: {
            in: ["sent", "done"]
          },
          secondPaymentSent: false
        },
        data: {
          status: "cancelled" // New status for room-ended-before-completion
        }
      });
    }

    // Mark all active viewers as left (since room is ending)
    if (viewerUserIds.length > 0) {
      await this.prisma.callViewer.updateMany({
        where: {
          sessionId: session.id,
          leftAt: null // Only update active viewers
        },
        data: {
          leftAt: new Date()
        }
      });
      this.logger.log(`Marked ${viewerUserIds.length} viewer(s) as left due to room ending: ${viewerUserIds.join(", ")}`);
    }

    // Notify discovery-service that call ended
    this.discoveryClient.notifyCallEnded(roomId, [...participantUserIds, ...viewerUserIds]).catch((err) => {
      this.logger.error(`Failed to notify discovery-service: ${err.message}`);
    });

    // Cancel all pending waitlist entries
    if (waitlistUserIds.length > 0) {
      await this.prisma.callWaitlist.updateMany({
        where: {
          sessionId: session.id,
          status: "pending"
        },
        data: {
          status: "cancelled"
        }
      });

      // Update waitlist users: MATCHED → VIEWER (users still in HMM_TV)
      this.logger.log(`Cancelling ${waitlistUserIds.length} waitlist entry(ies) and updating status: MATCHED → VIEWER`);
      this.discoveryClient.updateUserStatuses(waitlistUserIds, "VIEWER").catch((err) => {
        this.logger.error(`Failed to update waitlist user statuses: ${err.message}`);
      });
    }

    // BUSINESS RULE: When entire room ends:
    // - Participants revert to their previousStatus (excluding MATCHED)
    // - Viewers (not on waitlist) → VIEWER (still in HMM_TV)
    if (participantUserIds.length > 0) {
      // Group participants by previousStatus for batch updates
      const statusGroups = new Map<string, string[]>();

      for (const p of participants as any[]) {
        const previousStatus = p.previousStatus || "ONLINE"; // Default to ONLINE for legacy data
        let statusToRestore = previousStatus;

        // If user is already AVAILABLE (e.g. raincheck flow), do not downgrade to ONLINE.
        try {
          const currentStatus = await this.discoveryClient.getUserStatus(p.userId);
          if (currentStatus === "AVAILABLE") {
            statusToRestore = "AVAILABLE";
          }
        } catch (error: any) {
          this.logger.warn(`Failed to read current status for ${p.userId} during endRoom: ${error?.message || error}`);
        }

        // Never revert to MATCHED (it's transitional)
        if (statusToRestore !== "MATCHED") {
          if (!statusGroups.has(statusToRestore)) {
            statusGroups.set(statusToRestore, []);
          }
          statusGroups.get(statusToRestore)!.push(p.userId);
        } else {
          // If previousStatus is MATCHED (shouldn't happen, but handle gracefully), default to ONLINE
          if (!statusGroups.has("ONLINE")) {
            statusGroups.set("ONLINE", []);
          }
          statusGroups.get("ONLINE")!.push(p.userId);
        }
      }

      // Update each group to their previousStatus
      for (const [status, userIds] of statusGroups.entries()) {
        this.logger.log(`Reverting ${userIds.length} participant(s) to ${status} status: ${userIds.join(", ")}`);
        this.discoveryClient.updateUserStatuses(userIds, status as any).catch((err) => {
          this.logger.error(`Failed to update participant statuses to ${status}: ${err.message}`);
        });
      }
    }

    // Viewers (not on waitlist) revert to VIEWER (still in HMM_TV)
    const viewersNotOnWaitlist = viewerUserIds.filter(vId => !waitlistUserIds.includes(vId));
    if (viewersNotOnWaitlist.length > 0) {
      this.logger.log(`Updating ${viewersNotOnWaitlist.length} viewer(s) to VIEWER status (still in HMM_TV): ${viewersNotOnWaitlist.join(", ")}`);
      this.discoveryClient.updateUserStatuses(viewersNotOnWaitlist, "VIEWER").catch((err) => {
        this.logger.error(`Failed to update viewer statuses: ${err.message}`);
      });
    }

    this.logger.log(`Room ${roomId} ended`);
  }

  /**
   * Get participant state (from in-memory map)
   */
  getParticipant(roomId: string, userId: string): ParticipantState | undefined {
    const room = this.getRoom(roomId);
    return room.participants.get(userId);
  }

  /**
   * Check if user is a participant in the room (checks database)
   */
  async isParticipant(roomId: string, userId: string): Promise<boolean> {
    const session = await this.prisma.callSession.findUnique({
      where: { roomId },
      include: {
        participants: {
          where: {
            userId,
            status: "active"
          }
        }
      }
    });

    return !!(session?.participants && session.participants.length > 0);
  }

  /**
   * Check if user is a HOST in the room (checks database)
   */
  async isHost(roomId: string, userId: string): Promise<boolean> {
    const session = await this.prisma.callSession.findUnique({
      where: { roomId },
      include: {
        participants: {
          where: {
            userId,
            role: "HOST",
            status: "active"
          }
        }
      }
    });

    return !!(session?.participants && session.participants.length > 0);
  }

  /**
   * Check if user can kick another user (must be a HOST)
   */
  async canKickUser(roomId: string, kickerUserId: string, targetUserId: string): Promise<boolean> {
    // Kicker must be a HOST
    const isKickerHost = await this.isHost(roomId, kickerUserId);
    if (!isKickerHost) {
      return false;
    }

    // Cannot kick yourself
    if (String(kickerUserId) === String(targetUserId)) {
      return false;
    }

    // Target must be a participant (not a host)
    const session = await this.prisma.callSession.findUnique({
      where: { roomId },
      include: {
        participants: {
          where: {
            userId: targetUserId,
            status: "active"
          }
        }
      }
    });

    if (!session?.participants || session.participants.length === 0) {
      return false; // Target is not a participant
    }

    const targetParticipant = session.participants[0];
    // Hosts cannot kick other hosts
    if (targetParticipant.role === "HOST") {
      return false;
    }

    return true;
  }

  /**
   * Set participant state
   */
  setParticipant(roomId: string, userId: string, state: ParticipantState): void {
    const room = this.getRoom(roomId);
    room.participants.set(userId, state);
  }

  registerProducerOwner(roomId: string, producerId: string, ownerUserId: string): void {
    const room = this.getRoom(roomId);
    room.producerOwnerById.set(producerId, ownerUserId);
  }

  unregisterProducerOwner(roomId: string, producerId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.producerOwnerById.delete(producerId);
  }

  getProducerOwner(roomId: string, producerId: string): string | undefined {
    const room = this.rooms.get(roomId);
    return room?.producerOwnerById.get(producerId);
  }

  /**
   * Get viewer state
   */
  getViewer(roomId: string, userId: string): ViewerState | undefined {
    const room = this.getRoom(roomId);
    return room.viewers.get(userId);
  }

  /**
   * Set viewer state
   */
  setViewer(roomId: string, userId: string, state: ViewerState): void {
    const room = this.getRoom(roomId);
    room.viewers.set(userId, state);
  }

  /**
   * Raw DB lookup: active participant row (no user-service reconcile).
   */
  private async fetchActiveParticipantRoom(userId: string): Promise<{ roomId: string } | null> {
    const result = await this.prisma.$queryRaw<Array<{ roomId: string }>>`
      SELECT cs."roomId"
      FROM call_participants cp
      INNER JOIN call_sessions cs ON cp."sessionId" = cs.id
      WHERE cp."userId" = ${userId}
        AND cp.status = 'active'
        AND cp."leftAt" IS NULL
        AND cs.status != 'ENDED'
      ORDER BY cs."startedAt" DESC
      LIMIT 1
    `;

    if (!result || result.length === 0) {
      return null;
    }

    return { roomId: result[0].roomId };
  }

  /**
   * Get user's active room (as participant)
   * Returns the most recently started room if user is in multiple rooms
   */
  async getUserActiveRoom(userId: string): Promise<{ roomId: string } | null> {
    await this.runParticipantReconcileThrottled(userId);
    return this.fetchActiveParticipantRoom(userId);
  }

  /**
   * Get user's active room (as viewer)
   */
  async getUserActiveRoomAsViewer(userId: string): Promise<{ roomId: string } | null> {
    await this.runViewerReconcileThrottled(userId);

    const viewer = await this.prisma.callViewer.findFirst({
      where: {
        userId,
        leftAt: null
      },
      include: {
        session: true
      }
    });

    if (!viewer || !viewer.session) {
      return null;
    }

    if (viewer.session.status !== "IN_BROADCAST") {
      return null;
    }

    return { roomId: viewer.session.roomId };
  }

  /**
   * Get all active broadcasts (for HMM_TV feed)
   * Returns broadcasts with participant info and viewer count
   * Supports sorting, filtering, and pagination
   */
  async getActiveBroadcasts(options: {
    sort?: 'recent' | 'viewers' | 'popular' | 'trending';
    filter?: {
      participantCount?: { min?: number; max?: number };
      participantUserIds?: string[];
      gender?: string[];
      city?: string;
      tags?: string[];
    };
    limit?: number;
    offset?: number;
    cursor?: string;
  } = {}): Promise<{
    broadcasts: Array<{
      roomId: string;
      participantCount: number;
      viewerCount: number;
      participants: Array<{
        userId: string;
        role: string;
        joinedAt: Date;
        username?: string | null;
        displayPictureUrl?: string | null;
        age?: number | null;
      }>;
      startedAt: Date | null;
      createdAt: Date;
      broadcastTitle?: string | null;
      broadcastDescription?: string | null;
      broadcastTags?: string[];
      isTrending?: boolean;
      popularityScore?: number;
    }>;
    nextCursor?: string;
    hasMore: boolean;
  }> {
    const {
      sort = 'recent',
      filter = {},
      limit = 20,
      offset = 0,
      cursor
    } = options;

    // Build where clause
    const where: any = {
      status: "IN_BROADCAST",
      isBroadcasting: true
    };

    // Apply filters
    if (filter.tags && filter.tags.length > 0) {
      where.broadcastTags = {
        hasSome: filter.tags
      };
    }
    if (filter.participantUserIds && filter.participantUserIds.length > 0) {
      where.participants = {
        some: { userId: { in: filter.participantUserIds } }
      };
    }

    // Build orderBy
    let orderBy: any = { createdAt: "desc" };
    if (sort === 'viewers') {
      // Order by viewer count (will need to sort after fetching)
      orderBy = { createdAt: "desc" };
    } else if (sort === 'popular') {
      orderBy = { popularityScore: "desc" };
    } else if (sort === 'trending') {
      orderBy = [
        { isTrending: "desc" },
        { popularityScore: "desc" },
        { createdAt: "desc" }
      ];
    }

    // Handle cursor-based pagination
    if (cursor) {
      where.id = { gt: cursor };
    }

    const sessions = await this.prisma.callSession.findMany({
      where,
      include: {
        participants: {
          where: { leftAt: null },
          select: {
            userId: true,
            role: true,
            joinedAt: true
          }
        },
        viewers: {
          where: { leftAt: null },
          select: { userId: true }
        }
      },
      orderBy,
      take: limit + 1, // Fetch one extra to determine hasMore
      skip: cursor ? 0 : offset
    });

    const hasMore = sessions.length > limit;
    const sessionsToReturn = sessions.slice(0, limit);

    // Fetch participant profiles (username, displayPicture, age)
    const participantUserIds = new Set<string>();
    sessionsToReturn.forEach(session => {
      session.participants.forEach(p => participantUserIds.add(p.userId));
    });

    // Get user profiles from user-service (batch fetch to avoid N+1 queries)
    const participantProfiles = new Map<string, { username: string | null; displayPictureUrl: string | null; age: number | null }>();

    if (participantUserIds.size > 0) {
      try {
        const userIdsArray = Array.from(participantUserIds);
        // Use batch fetching to avoid N+1 query problem
        const profiles = await this.discoveryClient.getUserProfilesBatch(userIdsArray);
        profiles.forEach((profile, userId) => {
          participantProfiles.set(userId, profile);
        });
      } catch (error) {
        this.logger.warn(`Failed to fetch participant profiles: ${error}`);
      }
    }

    // Apply participant count filter if specified
    let filteredSessions = sessionsToReturn;
    if (filter.participantCount) {
      filteredSessions = sessionsToReturn.filter(session => {
        const count = session.participants.length;
        if (filter.participantCount!.min !== undefined && count < filter.participantCount!.min) {
          return false;
        }
        if (filter.participantCount!.max !== undefined && count > filter.participantCount!.max) {
          return false;
        }
        return true;
      });
    }

    // Sort by viewer count if requested
    if (sort === 'viewers') {
      filteredSessions.sort((a, b) => b.viewers.length - a.viewers.length);
    }

    const broadcasts = filteredSessions.map(session => {
      const participants = session.participants.map(p => {
        const profile = participantProfiles.get(p.userId);
        return {
          userId: p.userId,
          role: p.role,
          joinedAt: p.joinedAt,
          username: profile?.username || null,
          displayPictureUrl: profile?.displayPictureUrl || null,
          age: profile?.age || null
        };
      });

      return {
        roomId: session.roomId,
        participantCount: session.participants.length,
        viewerCount: session.viewers.length,
        participants,
        startedAt: session.startedAt,
        createdAt: session.createdAt,
        broadcastTitle: session.broadcastTitle,
        broadcastDescription: session.broadcastDescription,
        broadcastTags: session.broadcastTags || [],
        isTrending: session.isTrending,
        popularityScore: session.popularityScore
      };
    });

    return {
      broadcasts,
      nextCursor: hasMore ? filteredSessions[filteredSessions.length - 1].id : undefined,
      hasMore
    };
  }
}
