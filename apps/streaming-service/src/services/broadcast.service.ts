import { Injectable, Logger, NotFoundException, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { RoomService } from "./room.service.js";
import { MediasoupService } from "./mediasoup.service.js";
import { CallService, type VideoProducerSource } from "./call.service.js";
import { DiscoveryClientService } from "./discovery-client.service.js";
import { types as MediasoupTypes } from "mediasoup";

@Injectable()
export class BroadcastService {
  private readonly logger = new Logger(BroadcastService.name);

  constructor(
    private prisma: PrismaService,
    private roomService: RoomService,
    private mediasoup: MediasoupService,
    private callService: CallService,
    private discoveryClient: DiscoveryClientService
  ) {}

  /**
   * Start broadcasting a call
   */
  async startBroadcast(roomId: string, userId: string): Promise<void> {
    // Ensure room exists and is in memory (will reload if needed)
    const roomExists = await this.roomService.roomExists(roomId);
    if (!roomExists) {
      throw new NotFoundException(`Room ${roomId} not found`);
    }
    
    // Verify user is a participant (check database - source of truth)
    const isParticipant = await this.roomService.isParticipant(roomId, userId);
    if (!isParticipant) {
      throw new BadRequestException("Only participants can start broadcasting");
    }

    // Check broadcasting status from database (source of truth)
    const session = await this.prisma.callSession.findUnique({
      where: { roomId },
      select: { id: true, isBroadcasting: true }
    });

    if (!session) {
      throw new NotFoundException(`Session for room ${roomId} not found`);
    }

    if (session.isBroadcasting) {
      throw new BadRequestException("Room is already broadcasting");
    }

    // Enable broadcasting in room (HOST validation happens inside)
    await this.roomService.enableBroadcasting(roomId, userId);

    this.logger.log(`Broadcasting started for room ${roomId} by HOST ${userId}`);
  }

  /**
   * Stop broadcasting and return to IN_SQUAD (HOST only)
   */
  async stopBroadcast(roomId: string, userId: string): Promise<void> {
    // Ensure room exists and is in memory
    const roomExists = await this.roomService.roomExists(roomId);
    if (!roomExists) {
      throw new NotFoundException(`Room ${roomId} not found`);
    }

    // Check broadcasting status
    const session = await this.prisma.callSession.findUnique({
      where: { roomId },
      select: { id: true, isBroadcasting: true }
    });

    if (!session) {
      throw new NotFoundException(`Session for room ${roomId} not found`);
    }

    if (!session.isBroadcasting) {
      throw new BadRequestException("Room is not broadcasting");
    }

    // Disable broadcasting (HOST validation happens inside)
    await this.roomService.disableBroadcasting(roomId, userId);

    this.logger.log(`Broadcasting stopped for room ${roomId} by HOST ${userId}`);
  }

  /**
   * Add a viewer to the broadcast
   */
  async addViewer(roomId: string, userId: string): Promise<void> {
    // Ensure room exists and is in memory (will reload if needed)
    const roomExists = await this.roomService.roomExists(roomId);
    if (!roomExists) {
      throw new NotFoundException(`Room ${roomId} not found`);
    }

    // Check broadcasting status from database (source of truth)
    const session = await this.prisma.callSession.findUnique({
      where: { roomId },
      select: { id: true, isBroadcasting: true }
    });

    if (!session) {
      throw new NotFoundException(`Session for room ${roomId} not found`);
    }

    if (!session.isBroadcasting) {
      throw new BadRequestException("Room is not broadcasting");
    }

    // Check if user is already a participant (check database - source of truth)
    const isParticipant = await this.roomService.isParticipant(roomId, userId);
    if (isParticipant) {
      throw new BadRequestException("Participants cannot join as viewers");
    }

    await this.roomService.addViewer(roomId, userId);

    // Update user status to VIEWER (skip for anonymous users)
    const isAnonymous = userId.startsWith('anonymous:');
    if (!isAnonymous) {
      await this.discoveryClient.updateUserStatus(userId, "VIEWER").catch((err) => {
        this.logger.error(`Failed to update user ${userId} status to VIEWER: ${err.message}`);
      });
    }

    this.logger.log(`Viewer ${userId} added to broadcast ${roomId}`);
  }

  /**
   * Create transport for viewer
   */
  async createViewerTransport(
    roomId: string,
    userId: string
  ): Promise<MediasoupTypes.WebRtcTransport> {
    // Ensure room exists and is in memory (will reload if needed)
    const roomExists = await this.roomService.roomExists(roomId);
    if (!roomExists) {
      throw new NotFoundException(`Room ${roomId} not found`);
    }
    
    const room = this.roomService.getRoom(roomId);

    // Check broadcasting status from database (source of truth)
    const session = await this.prisma.callSession.findUnique({
      where: { roomId },
      select: { isBroadcasting: true }
    });

    if (!session || !session.isBroadcasting) {
      throw new BadRequestException("Room is not broadcasting");
    }

    const transport = await this.mediasoup.createWebRtcTransport(room.router, {
      producing: false,
      consuming: true
    });

    // Store transport in viewer state
    const viewer = this.roomService.getViewer(roomId, userId);
    if (viewer) {
      viewer.transport = transport;
      this.roomService.setViewer(roomId, userId, viewer);
    } else {
      // Create new viewer state
      this.roomService.setViewer(roomId, userId, {
        userId,
        transport,
        consumers: new Map()
      });
    }

    return transport;
  }

  /**
   * Connect viewer transport with DTLS parameters
   */
  async connectViewerTransport(
    roomId: string,
    userId: string,
    transportId: string,
    dtlsParameters: MediasoupTypes.DtlsParameters
  ): Promise<void> {
    // Ensure room exists and is in memory
    const roomExists = await this.roomService.roomExists(roomId);
    if (!roomExists) {
      throw new NotFoundException(`Room ${roomId} not found`);
    }

    // Check if viewer exists in database (source of truth)
    const session = await this.prisma.callSession.findUnique({
      where: { roomId },
      select: { id: true }
    });

    if (!session) {
      throw new NotFoundException(`Session for room ${roomId} not found`);
    }

    const viewerInDb = await this.prisma.callViewer.findFirst({
      where: {
        sessionId: session.id,
        userId,
        leftAt: null
      }
    });

    if (!viewerInDb) {
      throw new NotFoundException(`Viewer ${userId} not found in room ${roomId}`);
    }

    const viewer = this.roomService.getViewer(roomId, userId);
    if (!viewer) {
      throw new NotFoundException(`Viewer ${userId} transport not initialized. Please create transport first.`);
    }

    if (viewer.transport.id !== transportId) {
      throw new NotFoundException(`Transport ${transportId} not found`);
    }

    await viewer.transport.connect({ dtlsParameters });
    this.logger.log(`Viewer transport ${transportId} connected for user ${userId} in room ${roomId}`);
  }

  /**
   * Consume broadcast stream for viewer
   */
  async consumeBroadcast(
    roomId: string,
    userId: string,
    transportId: string,
    producerId: string,
    rtpCapabilities: MediasoupTypes.RtpCapabilities
  ): Promise<MediasoupTypes.Consumer> {
    // Ensure room exists and is in memory
    const roomExists = await this.roomService.roomExists(roomId);
    if (!roomExists) {
      throw new NotFoundException(`Room ${roomId} not found`);
    }
    
    // Check if viewer exists in database (source of truth)
    const session = await this.prisma.callSession.findUnique({
      where: { roomId },
      select: { id: true, isBroadcasting: true }
    });

    if (!session) {
      throw new NotFoundException(`Session for room ${roomId} not found`);
    }

    // Check if broadcast is still active
    if (!session.isBroadcasting) {
      throw new BadRequestException(`Room ${roomId} is no longer broadcasting`);
    }

    const viewerInDb = await this.prisma.callViewer.findFirst({
      where: {
        sessionId: session.id,
        userId,
        leftAt: null
      }
    });

    if (!viewerInDb) {
      throw new NotFoundException(`Viewer ${userId} not found in room ${roomId}`);
    }

    const viewer = this.roomService.getViewer(roomId, userId);
    if (!viewer) {
      // Viewer exists in DB but not in memory - this can happen if room was reloaded
      // The viewer needs to create transport first, so throw a more specific error
      throw new NotFoundException(`Viewer ${userId} transport not initialized. Please create transport first.`);
    }

    if (!viewer.transport) {
      throw new NotFoundException(`Viewer ${userId} transport not created. Please create transport first.`);
    }

    if (viewer.transport.id !== transportId) {
      throw new NotFoundException(`Transport ${transportId} not found`);
    }

    // Transport should be connected if it exists (connect() is called before consume)
    // Note: mediasoup WebRtcTransport doesn't expose connectionState directly

    const room = this.roomService.getRoom(roomId);
    
    // Check if producer still exists
    const producers = await this.callService.getProducers(roomId);
    const producerExists = producers.some(p => p.producerId === producerId);
    if (!producerExists) {
      throw new NotFoundException(`Producer ${producerId} not found in room ${roomId}. It may have disconnected.`);
    }

    const consumer = await this.mediasoup.createConsumer(
      room.router,
      viewer.transport,
      producerId,
      rtpCapabilities
    );

    // Store consumer
    viewer.consumers.set(producerId, consumer);
    this.roomService.setViewer(roomId, userId, viewer);

    this.logger.log(`Viewer ${userId} consuming producer ${producerId} in room ${roomId}`);

    return consumer;
  }

  /**
   * Get all producers for broadcast (from core participants)
   */
  async getBroadcastProducers(roomId: string): Promise<Array<{
    userId: string;
    producerId: string;
    kind: MediasoupTypes.MediaKind;
    source?: VideoProducerSource;
  }>> {
    return await this.callService.getProducers(roomId);
  }
}
