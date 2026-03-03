import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { RoomService } from "./room.service.js";
import { MediasoupService } from "./mediasoup.service.js";
import { types as MediasoupTypes } from "mediasoup";

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

  /**
   * Produce audio/video
   */
  async produce(
    roomId: string,
    userId: string,
    transportId: string,
    kind: MediasoupTypes.MediaKind,
    rtpParameters: MediasoupTypes.RtpParameters
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

    const producer = await this.mediasoup.createProducer(
      transport,
      rtpParameters,
      kind
    );

    // Store producer
    if (kind === "audio") {
      participant.producer.audio = producer;
    } else if (kind === "video") {
      participant.producer.video = producer;
    }

    this.roomService.setParticipant(roomId, userId, participant);

    this.logger.log(`Producer created: ${producer.id} (${kind}) for user ${userId}`);

    return producer;
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
    }> = [];

    for (const [userId, participant] of room.participants.entries()) {
      if (userId === excludeUserId) continue;

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
          kind: "video"
        });
      }
    }

    return producers;
  }
}
