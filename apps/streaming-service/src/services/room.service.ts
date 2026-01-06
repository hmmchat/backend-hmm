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
}

interface ParticipantState {
  userId: string;
  transport: MediasoupTypes.WebRtcTransport;
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

  constructor(
    private prisma: PrismaService,
    private mediasoup: MediasoupService,
    private discoveryClient: DiscoveryClientService
  ) {}

  /**
   * Create a new room when 2 users enter IN_SQUAD
   */
  async createRoom(userIds: string[]): Promise<{ roomId: string; sessionId: string }> {
    // Validate input first
    if (userIds.length < 2 || userIds.length > this.maxParticipants) {
      throw new BadRequestException(
        `Room must have between 2 and ${this.maxParticipants} participants`
      );
    }

    // Check for duplicate user IDs
    const uniqueUserIds = new Set(userIds);
    if (uniqueUserIds.size !== userIds.length) {
      throw new BadRequestException("Duplicate user IDs are not allowed");
    }

    // BUSINESS RULE: Only users with status MATCHED can create/join rooms
    // Valid source statuses: AVAILABLE, IN_SQUAD_AVAILABLE, IN_BROADCAST_AVAILABLE → MATCHED → IN_SQUAD
    
    // Check user statuses from user-service
    const invalidStatusUsers: string[] = [];
    const usersInRooms: string[] = [];
    
    try {
      // Check if any user is already in an active room (same validation as before)
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

      if (usersInRooms.length > 0) {
        throw new BadRequestException(
          `Users ${usersInRooms.join(", ")} are already in an active room. Please leave the current room before creating a new one.`
        );
      }

      // Validate that all users have MATCHED status (required to create/join room)
      // In TEST_MODE, skip status validation
      if (process.env.TEST_MODE !== "true") {
        for (const userId of userIds) {
          try {
            const userStatus = await this.discoveryClient.getUserStatus(userId);
            
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
            `Valid statuses to become MATCHED: AVAILABLE, IN_SQUAD_AVAILABLE, IN_BROADCAST_AVAILABLE`
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

      // Create database session
      const session = await this.prisma.callSession.create({
        data: {
          roomId,
          status: "IN_SQUAD",
          isBroadcasting: false,
          maxParticipants: this.maxParticipants,
          startedAt: new Date(),
          participants: {
            create: userIds.map((userId, index) => ({
              userId,
              role: index === 0 ? "HOST" : "PARTICIPANT",
              status: "active"
            }))
          },
          events: {
            create: {
              eventType: "room_created",
              metadata: JSON.stringify({ userIds })
            }
          }
        }
      });

      // Create in-memory room state
      const roomState: RoomState = {
        router,
        participants: new Map(),
        viewers: new Map(),
        isBroadcasting: false
      };

      this.rooms.set(roomId, roomState);

      this.logger.log(`Room created: ${roomId} with ${userIds.length} participants`);

      // Notify discovery-service that users entered IN_SQUAD
      this.discoveryClient.notifyRoomCreated(roomId, userIds).catch((err) => {
        this.logger.error(`Failed to notify discovery-service: ${err.message}`);
      });

      // BUSINESS RULE: When users enter a room, their status changes to IN_SQUAD
      // Update user statuses from MATCHED → IN_SQUAD
      this.discoveryClient.updateUserStatuses(userIds, "IN_SQUAD").catch((err) => {
        this.logger.error(`Failed to update user statuses: ${err.message}`);
      });

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
      isBroadcasting: session.isBroadcasting || false
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
    // In TEST_MODE, skip status validation
    if (process.env.TEST_MODE !== "true") {
      try {
        const userStatus = await this.discoveryClient.getUserStatus(userId);
        
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

    // Add to database
    await this.prisma.callParticipant.create({
      data: {
        sessionId: session.id,
        userId,
        role: "PARTICIPANT",
        status: "active"
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
    // BUSINESS RULE: Room cannot exist with only 1 person
    // If 1 or 0 participants remain, automatically end the room
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

    // If only 1 participant remains, automatically remove them and end the room
    if (activeParticipants.length === 1) {
      const lastUserId = activeParticipants[0].userId;
      this.logger.log(`Only 1 participant (${lastUserId}) remains in room ${roomId}. Auto-removing and ending room.`);
      
      // Mark the last participant as left
      await this.prisma.callParticipant.updateMany({
        where: {
          sessionId: session.id,
          userId: lastUserId,
          status: "active",
          leftAt: null
        },
        data: {
          leftAt: new Date(),
          status: "left"
        }
      });

      // End the room (this will update all remaining users' statuses including the last one)
      await this.endRoom(roomId);
      return; // endRoom will handle status updates for all users
    }

    // More than 1 participant remains - room continues, only update leaving user's status
    // Update user status to AVAILABLE
    this.discoveryClient.updateUserStatus(userId, "AVAILABLE").catch((err) => {
      this.logger.error(`Failed to update user ${userId} status to AVAILABLE: ${err.message}`);
    });

    this.logger.log(`Participant ${userId} removed from database for room ${roomId}, status updated to AVAILABLE`);
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
      // Close transport and producers
      participant.transport.close();
      if (participant.producer.audio) participant.producer.audio.close();
      if (participant.producer.video) participant.producer.video.close();
      
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
      // BUSINESS RULE: Room cannot exist with only 1 person
      // If 1 or 0 participants remain, automatically end the room
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

      // If only 1 participant remains, automatically remove them and end the room
      if (activeParticipants.length === 1) {
        const lastUserId = activeParticipants[0].userId;
        this.logger.log(`Only 1 participant (${lastUserId}) remains in room ${roomId}. Auto-removing and ending room.`);
        
        // Mark the last participant as left
        await this.prisma.callParticipant.updateMany({
          where: {
            sessionId: session.id,
            userId: lastUserId,
            status: "active",
            leftAt: null
          },
          data: {
            leftAt: new Date(),
            status: "left"
          }
        });

        // End the room (this will update all remaining users' statuses including the last one)
        await this.endRoom(roomId);
        return; // endRoom will handle status updates for all users
      }

      // More than 1 participant remains - room continues, only update leaving user's status
    }

    // BUSINESS RULE: When individual user leaves (and room continues), status changes to AVAILABLE
    // This returns them to the discovery pool so they can be matched again
    // Update user status from IN_SQUAD/IN_BROADCAST → AVAILABLE
    this.discoveryClient.updateUserStatus(userId, "AVAILABLE").catch((err) => {
      this.logger.error(`Failed to update user ${userId} status to AVAILABLE: ${err.message}`);
    });

    this.logger.log(`Participant ${userId} removed from room ${roomId}, status updated to AVAILABLE (back to discovery pool)`);
  }

  /**
   * Enable broadcasting mode
   */
  async enableBroadcasting(roomId: string): Promise<void> {
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

    this.logger.log(`Broadcasting enabled for room ${roomId}`);
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
   */
  async removeViewer(roomId: string, userId: string): Promise<void> {
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
      // Close transport
      viewer.transport.close();
      
      // Close all consumers
      for (const consumer of viewer.consumers.values()) {
        consumer.close();
      }

      room.viewers.delete(userId);
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

    // BUSINESS RULE: When viewer leaves/stream ends, status changes to OFFLINE
    // Viewers are not in matchmaking pool, so they go offline when they stop watching
    this.discoveryClient.updateUserStatus(userId, "OFFLINE").catch((err) => {
      this.logger.error(`Failed to update viewer ${userId} status to OFFLINE: ${err.message}`);
    });

    this.logger.log(`Viewer ${userId} removed from room ${roomId}, status updated to OFFLINE`);
  }

  /**
   * End a call/room
   * Handles ending room gracefully even if not in memory
   */
  async endRoom(roomId: string): Promise<void> {
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
        participant.transport.close();
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

    // Update database
    await this.prisma.callSession.update({
      where: { id: session.id },
      data: {
        status: "ENDED",
        endedAt: new Date()
      }
    });

    await this.prisma.callEvent.create({
      data: {
        sessionId: session.id,
        eventType: "call_ended",
        metadata: JSON.stringify({ roomId })
      }
    });

    // Get all user IDs (active participants + active viewers) at time of room end
    // This includes any remaining participants and the user who just left
    const participants = await this.prisma.callParticipant.findMany({
      where: { 
        sessionId: session.id,
        // Include both active and just-left participants to update all their statuses
      },
      select: { userId: true }
    });
    const viewers = await this.prisma.callViewer.findMany({
      where: { 
        sessionId: session.id, 
        leftAt: null // Only active viewers
      },
      select: { userId: true }
    });
    
    const participantUserIds = participants.map((p: any) => p.userId);
    const viewerUserIds = viewers.map((v: any) => v.userId);

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

    // BUSINESS RULE: When entire room ends:
    // - Participants (IN_SQUAD/IN_BROADCAST) → AVAILABLE (back to discovery pool)
    // - Viewers (WATCHING_HMM_TV) → OFFLINE (they stop watching, not in matchmaking)
    if (participantUserIds.length > 0) {
      this.logger.log(`Updating ${participantUserIds.length} participant(s) to AVAILABLE status: ${participantUserIds.join(", ")}`);
      this.discoveryClient.updateUserStatuses(participantUserIds, "AVAILABLE").catch((err) => {
        this.logger.error(`Failed to update participant statuses: ${err.message}`);
      });
    }

    if (viewerUserIds.length > 0) {
      this.logger.log(`Updating ${viewerUserIds.length} viewer(s) to OFFLINE status: ${viewerUserIds.join(", ")}`);
      this.discoveryClient.updateUserStatuses(viewerUserIds, "OFFLINE").catch((err) => {
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
   * Set participant state
   */
  setParticipant(roomId: string, userId: string, state: ParticipantState): void {
    const room = this.getRoom(roomId);
    room.participants.set(userId, state);
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
   * Get user's active room (as participant)
   */
  async getUserActiveRoom(userId: string): Promise<{ roomId: string } | null> {
    const participant = await this.prisma.callParticipant.findFirst({
      where: {
        userId,
        status: "active",
        leftAt: null
      },
      include: {
        session: true
      }
    });

    if (!participant || !participant.session) {
      return null;
    }

    // Only return if session is still active (not ended)
    if (participant.session.status === "ENDED") {
      return null;
    }

    return { roomId: participant.session.roomId };
  }

  /**
   * Get user's active room (as viewer)
   */
  async getUserActiveRoomAsViewer(userId: string): Promise<{ roomId: string } | null> {
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

    // Only return if session is still active and broadcasting
    if (viewer.session.status !== "IN_BROADCAST") {
      return null;
    }

    return { roomId: viewer.session.roomId };
  }
}
