import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { RoomService } from "./room.service.js";
import { MediasoupService } from "./mediasoup.service.js";
import { types as MediasoupTypes } from "mediasoup";

/** Distinguishes webcam vs display/application capture (both are mediasoup kind "video"). */
export type VideoProducerSource = "camera" | "screen";

@Injectable()
export class CallService {
  private readonly logger = new Logger(CallService.name);

  constructor(
    private roomService: RoomService,
    private mediasoup: MediasoupService
  ) { }

  /**
   * Create a WebRTC transport for a participant
   */
  async createTransport(
    roomId: string,
    userId: string,
    options: { producing?: boolean; consuming?: boolean } = {}
  ): Promise<MediasoupTypes.WebRtcTransport> {
    // Ensure room exists and is in memory (will reload if needed)
    const roomExists = await this.roomService.roomExists(roomId);
    if (!roomExists) {
      throw new NotFoundException(`Room ${roomId} not found`);
    }

    const room = this.roomService.getRoom(roomId);
    const transport = await this.mediasoup.createWebRtcTransport(room.router, options);

    // Store transport in participant state
    const participant = this.roomService.getParticipant(roomId, userId);
    if (participant) {
      participant.transports.set(transport.id, transport);
      this.roomService.setParticipant(roomId, userId, participant);
    } else {
      // Create new participant state
      const transports = new Map<string, any>();
      transports.set(transport.id, transport);
      this.roomService.setParticipant(roomId, userId, {
        userId,
        transports,
        producer: {},
        consumers: new Map()
      });
    }

    return transport;
  }

  /**
   * Connect a transport with DTLS parameters
   */
  async connectTransport(
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

    const participant = this.roomService.getParticipant(roomId, userId);
    if (!participant) {
      // Participant might exist in database but not have transport yet
      // Verify they're a participant in database
      const isParticipant = await this.roomService.isParticipant(roomId, userId);
      if (!isParticipant) {
        throw new NotFoundException(`Participant ${userId} not found in room ${roomId}`);
      }
      throw new NotFoundException(`Participant ${userId} transport not initialized. Please create transport first.`);
    }

    const transport = participant.transports.get(transportId);
    if (!transport) {
      throw new NotFoundException(`Transport ${transportId} not found`);
    }

    await transport.connect({ dtlsParameters });
    this.logger.log(`Transport ${transportId} connected for user ${userId}`);
  }

  private cleanupConsumersForProducer(roomId: string, producerId: string): void {
    const room = this.roomService.getRoom(roomId);
    for (const participant of room.participants.values()) {
      const consumer = participant.consumers.get(producerId);
      if (!consumer) continue;
      try {
        consumer.close();
      } catch {
        /* already closed */
      }
      participant.consumers.delete(producerId);
    }
    for (const viewer of room.viewers.values()) {
      const consumer = viewer.consumers.get(producerId);
      if (!consumer) continue;
      try {
        consumer.close();
      } catch {
        /* already closed */
      }
      viewer.consumers.delete(producerId);
    }
  }

  /**
   * Produce audio/video (and optional screen share: second video via source "screen")
   */
  async produce(
    roomId: string,
    userId: string,
    transportId: string,
    kind: MediasoupTypes.MediaKind,
    rtpParameters: MediasoupTypes.RtpParameters,
    options?: { source?: VideoProducerSource }
  ): Promise<MediasoupTypes.Producer> {
    // Ensure room exists and is in memory
    const roomExists = await this.roomService.roomExists(roomId);
    if (!roomExists) {
      throw new NotFoundException(`Room ${roomId} not found`);
    }

    const participant = this.roomService.getParticipant(roomId, userId);
    if (!participant) {
      // Participant might exist in database but not have transport yet
      const isParticipant = await this.roomService.isParticipant(roomId, userId);
      if (!isParticipant) {
        throw new NotFoundException(`Participant ${userId} not found in room ${roomId}`);
      }
      throw new NotFoundException(`Participant ${userId} transport not initialized. Please create transport first.`);
    }

    const transport = participant.transports.get(transportId);
    if (!transport) {
      throw new NotFoundException(`Transport ${transportId} not found`);
    }

    const videoSource: VideoProducerSource =
      kind === "video" ? (options?.source === "screen" ? "screen" : "camera") : "camera";

    if (kind === "video" && options?.source !== undefined && options.source !== "camera" && options.source !== "screen") {
      throw new Error('Invalid video source: use "camera" or "screen"');
    }
    if (kind === "audio" && options?.source !== undefined) {
      throw new Error("source is only valid when kind is video");
    }

    const appData: Record<string, unknown> | undefined =
      kind === "video" ? { source: videoSource } : undefined;

    const producer = await this.mediasoup.createProducer(transport, rtpParameters, kind, appData);

    // Store producer
    if (kind === "audio") {
      if (participant.producer.audio) {
        const oldId = participant.producer.audio.id;
        this.roomService.unregisterProducerOwner(roomId, oldId);
        this.cleanupConsumersForProducer(roomId, oldId);
        participant.producer.audio.close();
      }
      participant.producer.audio = producer;
    } else if (kind === "video") {
      if (videoSource === "screen") {
        if (participant.producer.screen) {
          const oldId = participant.producer.screen.id;
          this.roomService.unregisterProducerOwner(roomId, oldId);
          this.cleanupConsumersForProducer(roomId, oldId);
          participant.producer.screen.close();
        }
        participant.producer.screen = producer;
      } else {
        if (participant.producer.video) {
          const oldId = participant.producer.video.id;
          this.roomService.unregisterProducerOwner(roomId, oldId);
          this.cleanupConsumersForProducer(roomId, oldId);
          participant.producer.video.close();
        }
        participant.producer.video = producer;
      }
    }

    this.roomService.registerProducerOwner(roomId, producer.id, userId);
    this.roomService.setParticipant(roomId, userId, participant);

    this.logger.log(
      `Producer created: ${producer.id} (${kind}${kind === "video" ? `, ${videoSource}` : ""}) for user ${userId}`
    );

    return producer;
  }

  /**
   * Close a producer owned by this participant (e.g. user stops screen share).
   */
  async closeProducer(roomId: string, userId: string, producerId: string): Promise<void> {
    const roomExists = await this.roomService.roomExists(roomId);
    if (!roomExists) {
      throw new NotFoundException(`Room ${roomId} not found`);
    }

    const participant = this.roomService.getParticipant(roomId, userId);
    if (!participant) {
      const isParticipant = await this.roomService.isParticipant(roomId, userId);
      if (!isParticipant) {
        throw new NotFoundException(`Participant ${userId} not found in room ${roomId}`);
      }
      throw new NotFoundException(`Participant ${userId} transport not initialized`);
    }

    let slot: "audio" | "video" | "screen" | null = null;
    if (participant.producer.audio?.id === producerId) slot = "audio";
    else if (participant.producer.video?.id === producerId) slot = "video";
    else if (participant.producer.screen?.id === producerId) slot = "screen";

    if (!slot) {
      throw new NotFoundException(`Producer ${producerId} not found for user ${userId}`);
    }

    this.roomService.unregisterProducerOwner(roomId, producerId);
    this.cleanupConsumersForProducer(roomId, producerId);

    if (slot === "audio" && participant.producer.audio) {
      try {
        participant.producer.audio.close();
      } catch {
        /* ignore */
      }
      delete participant.producer.audio;
    } else if (slot === "video" && participant.producer.video) {
      try {
        participant.producer.video.close();
      } catch {
        /* ignore */
      }
      delete participant.producer.video;
    } else if (slot === "screen" && participant.producer.screen) {
      try {
        participant.producer.screen.close();
      } catch {
        /* ignore */
      }
      delete participant.producer.screen;
    }

    this.roomService.setParticipant(roomId, userId, participant);
    this.logger.log(`Producer closed: ${producerId} (${slot}) for user ${userId}`);
  }

  /**
   * Consume audio/video from another participant
   */
  async consume(
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

    const participant = this.roomService.getParticipant(roomId, userId);
    if (!participant) {
      // Participant might exist in database but not have transport yet
      const isParticipant = await this.roomService.isParticipant(roomId, userId);
      if (!isParticipant) {
        throw new NotFoundException(`Participant ${userId} not found in room ${roomId}`);
      }
      throw new NotFoundException(`Participant ${userId} transport not initialized. Please create transport first.`);
    }

    const transport = participant.transports.get(transportId);
    if (!transport) {
      throw new NotFoundException(`Transport ${transportId} not found`);
    }

    const room = this.roomService.getRoom(roomId);
    const consumer = await this.mediasoup.createConsumer(
      room.router,
      transport,
      producerId,
      rtpCapabilities
    );

    // Store consumer
    participant.consumers.set(producerId, consumer);
    this.roomService.setParticipant(roomId, userId, participant);

    this.logger.log(`Consumer created: ${consumer.id} for producer ${producerId} (user ${userId})`);

    return consumer;
  }

  /**
   * Get all producers in a room (for consuming)
   */
  async getProducers(roomId: string, excludeUserId?: string): Promise<Array<{
    userId: string;
    producerId: string;
    kind: MediasoupTypes.MediaKind;
    /** Present for video: camera vs screen/application share */
    source?: VideoProducerSource;
  }>> {
    // Ensure room exists and is in memory
    const roomExists = await this.roomService.roomExists(roomId);
    if (!roomExists) {
      throw new NotFoundException(`Room ${roomId} not found`);
    }

    const room = this.roomService.getRoom(roomId);
    const producers: Array<{
      userId: string;
      producerId: string;
      kind: MediasoupTypes.MediaKind;
      source?: VideoProducerSource;
    }> = [];

    for (const [userId, participant] of room.participants.entries()) {
      if (excludeUserId !== undefined && String(userId) === String(excludeUserId)) continue;

      if (participant.producer.audio) {
        producers.push({
          userId,
          producerId: participant.producer.audio.id,
          kind: "audio"
        });
      }

      if (participant.producer.video) {
        producers.push({
          userId,
          producerId: participant.producer.video.id,
          kind: "video",
          source: "camera"
        });
      }

      if (participant.producer.screen) {
        producers.push({
          userId,
          producerId: participant.producer.screen.id,
          kind: "video",
          source: "screen"
        });
      }
    }

    return producers;
  }

  /** For signaling: whether a video producer is camera or screen share */
  getVideoProducerSource(roomId: string, producerId: string): VideoProducerSource | undefined {
    const room = this.roomService.getRoom(roomId);
    for (const participant of room.participants.values()) {
      if (participant.producer.video?.id === producerId) return "camera";
      if (participant.producer.screen?.id === producerId) return "screen";
    }
    return undefined;
  }
}
