import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy
} from "@nestjs/common";
import { WebSocketServer } from "ws";
import { RoomService } from "../services/room.service.js";
import { MediasoupService } from "../services/mediasoup.service.js";
import { CallService } from "../services/call.service.js";
import { BroadcastService } from "../services/broadcast.service.js";
import { ChatService } from "../services/chat.service.js";
import { DareService } from "../services/dare.service.js";
import { IcebreakerService } from "../services/icebreaker.service.js";
import { FriendClientService } from "../services/friend-client.service.js";
import { verifyToken, AccessPayload } from "@hmm/common";
import { JWK } from "jose";

interface WebSocketMessage {
  type: string;
  data?: any;
}

@Injectable()
export class StreamingGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StreamingGateway.name);
  private wss: WebSocketServer | null = null;
  private verifyAccess!: (token: string) => Promise<AccessPayload>;
  private publicJwk!: JWK;
  private connections = new Map<string, { ws: any; userId: string; roomId?: string; isAnonymous?: boolean }>();
  private readonly testMode: boolean;

  constructor(
    private roomService: RoomService,
    private mediasoup: MediasoupService,
    private callService: CallService,
    private broadcastService: BroadcastService,
    private chatService: ChatService,
    private dareService: DareService,
    private icebreakerService: IcebreakerService,
    private friendClient: FriendClientService
  ) {
    this.testMode = process.env.TEST_MODE === "true" || process.env.NODE_ENV === "test";
  }

  async onModuleInit() {
    // Re-check test mode here (env vars might not be loaded in constructor)
    const testMode = process.env.TEST_MODE === "true" || process.env.NODE_ENV === "test";

    // Initialize JWT verification only if not in test mode
    if (!testMode) {
      const jwkStr = process.env.JWT_PUBLIC_JWK;
      if (!jwkStr || jwkStr === "undefined") {
        throw new Error("JWT_PUBLIC_JWK environment variable is not set or is invalid");
      }
      const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
      this.publicJwk = JSON.parse(cleanedJwk) as JWK;
      this.verifyAccess = await verifyToken(this.publicJwk);
    } else {
      this.logger.warn("⚠️  TEST MODE ENABLED - Authentication is bypassed");
      // Create a dummy verify function for test mode
      this.verifyAccess = async (token: string) => {
        // In test mode, accept token as userId directly, or extract from query param
        return { sub: token || "test-user" } as AccessPayload;
      };
    }
  }

  /**
   * Initialize WebSocket server with ws package
   */
  initialize(wss: WebSocketServer) {
    wss.on("connection", (ws: any, req: any) => {
      // Check if this is the correct path
      const url = req.url || '';
      if (!url.includes('/streaming/ws')) {
        this.logger.warn(`WebSocket connection to wrong path: ${url}`);
        ws.close(1008, 'Invalid path');
        return;
      }

      // Log request details for debugging
      this.logger.debug(`WebSocket connection - url: ${url}`);
      this.handleConnection(ws, req);
    });

    this.logger.log("WebSocket gateway initialized at /streaming/ws");
  }

  /**
   * Handle new WebSocket connection
   */
  private async handleConnection(ws: any, req: any) {
    const connectionId = this.generateConnectionId();
    let userId: string | null = null;
    let isAnonymous = false;

    // Authenticate connection (or allow anonymous)
    try {
      if (this.testMode) {
        // In test mode, get userId from query param or use default
        // For ws package, req.url contains the path with query string like "/streaming/ws?userId=xxx"
        let urlString = '';

        // Try different ways to get the URL
        if (req && typeof req === 'object') {
          urlString = req.url || req.path || '';
          // Also check if it's an IncomingMessage with url property
          if (!urlString && (req as any).socket) {
            urlString = (req as any).url || '';
          }
        }

        // For ws package, req is an IncomingMessage object
        // req.url contains the path with query string: "/streaming/ws?userId=xxx"
        urlString = req?.url || '';

        this.logger.debug(`[TEST MODE] WebSocket connection - req.url: ${urlString}, req keys: ${req ? Object.keys(req).join(',') : 'null'}`);

        if (urlString && urlString.includes('?')) {
          try {
            // Parse query string manually
            const queryString = urlString.split('?')[1];
            const params = new URLSearchParams(queryString);
            userId = params.get("userId") || "test-user-1";
          } catch (e) {
            // If URL parsing fails, try manual regex parsing
            const match = urlString.match(/[?&]userId=([^&]*)/);
            userId = match ? decodeURIComponent(match[1]) : "test-user-1";
          }
        } else {
          // No query params, use default
          userId = "test-user-1";
        }
        this.logger.log(`[TEST MODE] WebSocket connection with userId: ${userId} (from url: ${urlString})`);
      } else {
        const token = this.extractToken(req);
        if (token) {
          // Authenticated user
          const payload = await this.verifyAccess(token);
          userId = payload.sub;
        } else {
          // Anonymous user - get deviceId from query params
          const deviceId = this.extractDeviceId(req);
          if (!deviceId) {
            this.sendError(ws, "Authentication required or deviceId must be provided");
            ws.close();
            return;
          }
          userId = `anonymous:${deviceId}`;
          isAnonymous = true;
        }
      }

      this.connections.set(connectionId, { ws: ws, userId, isAnonymous });
    } catch (error) {
      this.logger.error("WebSocket authentication failed:", error);
      this.sendError(ws, "Invalid or expired token");
      ws.close();
      return;
    }

    this.logger.log(`WebSocket connection established: ${connectionId} (user: ${userId})`);

    // Handle messages
    ws.on("message", async (message: Buffer) => {
      try {
        const data = JSON.parse(message.toString()) as WebSocketMessage;
        await this.handleMessage(connectionId, userId!, data, ws);
      } catch (error) {
        this.logger.error(`Error handling message from ${connectionId}:`, error);
        this.sendError(ws, "Invalid message format");
      }
    });

    // Handle disconnection — read roomId from connection map (handleJoinRoom sets conn.roomId;
    // the outer `roomId` variable was never assigned and stayed null, so participants were never removed on tab close).
    ws.on("close", () => {
      const conn = this.connections.get(connectionId);
      const roomIdFromConn = conn?.roomId ?? null;
      void this.handleDisconnection(connectionId, userId!, roomIdFromConn).catch((err) => {
        this.logger.error(`[Disconnect] handleDisconnection error for ${userId}: ${err?.message || err}`);
      });
      this.connections.delete(connectionId);
    });

    // Handle errors
    ws.on("error", (error: Error) => {
      this.logger.error(`WebSocket error for ${connectionId}:`, error);
    });
  }

  /**
   * Check if user is anonymous
   */
  private isAnonymousUser(userId: string): boolean {
    return userId.startsWith('anonymous:');
  }

  /**
   * Handle incoming WebSocket messages
   */
  private async handleMessage(
    connectionId: string,
    userId: string,
    message: WebSocketMessage,
    ws: any
  ) {
    const { type, data } = message;

    try {
      switch (type) {
        // Room management
        case "join-room":
          if (this.isAnonymousUser(userId)) {
            this.sendError(ws, "Authentication required. Please sign up to join rooms.");
            return;
          }
          await this.handleJoinRoom(connectionId, userId, data, ws);
          break;

        case "leave-room":
          if (this.isAnonymousUser(userId)) {
            this.sendError(ws, "Authentication required. Please sign up to leave rooms.");
            return;
          }
          await this.handleLeaveRoom(connectionId, userId, data);
          break;

        case "kick-user":
          if (this.isAnonymousUser(userId)) {
            this.sendError(ws, "Authentication required. Please sign up to use this feature.");
            return;
          }
          await this.handleKickUser(connectionId, userId, data, ws);
          break;

        // Call signaling (for participants)
        case "create-transport":
          if (this.isAnonymousUser(userId)) {
            this.sendError(ws, "Authentication required. Please sign up to participate in calls.");
            return;
          }
          await this.handleCreateTransport(connectionId, userId, data, ws);
          break;

        case "connect-transport":
          if (this.isAnonymousUser(userId)) {
            this.sendError(ws, "Authentication required. Please sign up to participate in calls.");
            return;
          }
          await this.handleConnectTransport(connectionId, userId, data);
          break;

        case "produce":
          if (this.isAnonymousUser(userId)) {
            this.sendError(ws, "Authentication required. Please sign up to participate in calls.");
            return;
          }
          await this.handleProduce(connectionId, userId, data, ws);
          break;

        case "consume":
          if (this.isAnonymousUser(userId)) {
            this.sendError(ws, "Authentication required. Please sign up to participate in calls.");
            return;
          }
          await this.handleConsume(connectionId, userId, data, ws);
          break;

        case "get-producers":
          if (this.isAnonymousUser(userId)) {
            this.sendError(ws, "Authentication required. Please sign up to participate in calls.");
            return;
          }
          await this.handleGetProducers(connectionId, userId, data, ws);
          break;

        // Broadcasting
        case "start-broadcast":
          if (this.isAnonymousUser(userId)) {
            this.sendError(ws, "Authentication required. Please sign up to start broadcasting.");
            return;
          }
          await this.handleStartBroadcast(connectionId, userId, data, ws);
          break;

        case "stop-broadcast":
          if (this.isAnonymousUser(userId)) {
            this.sendError(ws, "Authentication required. Please sign up to use this feature.");
            return;
          }
          await this.handleStopBroadcast(connectionId, userId, data, ws);
          break;

        case "join-as-viewer":
          // Allow anonymous users to join as viewers
          await this.handleJoinAsViewer(connectionId, userId, data, ws);
          break;

        case "create-viewer-transport":
          // Allow anonymous users to create viewer transport
          await this.handleCreateViewerTransport(connectionId, userId, data, ws);
          break;

        case "connect-viewer-transport":
          // Allow anonymous users to connect viewer transport
          await this.handleConnectViewerTransport(connectionId, userId, data);
          break;

        case "get-broadcast-producers":
          // Allow anonymous users to get broadcast producers
          await this.handleGetBroadcastProducers(connectionId, userId, data, ws);
          break;

        case "consume-broadcast":
          // Allow anonymous users to consume broadcast streams
          await this.handleConsumeBroadcast(connectionId, userId, data, ws);
          break;

        // Chat
        case "chat-message":
          if (this.isAnonymousUser(userId)) {
            this.sendError(ws, "Authentication required. Please sign up to send messages.");
            return;
          }
          await this.handleChatMessage(connectionId, userId, data, ws);
          break;

        // Dares
        case "dare-view":
          if (this.isAnonymousUser(userId)) {
            this.sendError(ws, "Authentication required. Please sign up to use this feature.");
            return;
          }
          await this.handleDareView(connectionId, userId, data, ws);
          break;

        case "dare-assign":
          if (this.isAnonymousUser(userId)) {
            this.sendError(ws, "Authentication required. Please sign up to use this feature.");
            return;
          }
          await this.handleDareAssign(connectionId, userId, data, ws);
          break;

        case "dare-send":
          if (this.isAnonymousUser(userId)) {
            this.sendError(ws, "Authentication required. Please sign up to use this feature.");
            return;
          }
          await this.handleDareSend(connectionId, userId, data, ws);
          break;

        // Icebreakers
        case "get-icebreaker":
          if (this.isAnonymousUser(userId)) {
            this.sendError(ws, "Authentication required. Please sign up to use this feature.");
            return;
          }
          await this.handleGetIcebreaker(connectionId, userId, data, ws);
          break;

        // Friend requests (during call)
        case "send-friend-request":
          if (this.isAnonymousUser(userId)) {
            this.sendError(ws, "Authentication required. Please sign up to send friend requests.");
            return;
          }
          await this.handleSendFriendRequest(connectionId, userId, data, ws);
          break;

        default:
          this.sendError(ws, `Unknown message type: ${type}`);
      }
    } catch (error: any) {
      this.logger.error(`Error handling ${type} for ${connectionId}:`, error);
      this.sendError(ws, error.message || "Internal server error");
    }
  }

  /**
   * Handle join room
   */
  private async handleJoinRoom(
    connectionId: string,
    userId: string,
    data: any,
    ws: any
  ) {
    const { roomId } = data;
    if (!roomId) {
      this.sendError(ws, "roomId is required");
      return;
    }

    try {
      // Check if room exists (checks both memory and database)
      const roomExists = await this.roomService.roomExists(roomId);
      if (!roomExists) {
        this.sendError(ws, `Room ${roomId} not found`);
        return;
      }

      const conn = this.connections.get(connectionId);
      if (conn) {
        conn.roomId = roomId;
      }

      // Check if user is already a participant (from room creation or previous join)
      const isAlreadyParticipant = await this.roomService.isParticipant(roomId, userId);

      // If not already a participant, add them to the room
      if (!isAlreadyParticipant) {
        try {
          await this.roomService.addParticipant(roomId, userId);
          this.logger.log(`[JoinRoom] User ${userId} added as participant to room ${roomId}`);
        } catch (error: any) {
          // If user is already in room or other validation error, handle gracefully
          if (error.message?.includes("already in room") || error.message?.includes("already a participant")) {
            this.logger.debug(`[JoinRoom] User ${userId} is already in room ${roomId}`);
          } else {
            // Re-throw other errors (validation, room full, etc.)
            throw error;
          }
        }
      }

      // Get router RTP capabilities
      const room = this.roomService.getRoom(roomId);
      const rtpCapabilities = this.mediasoup.getRtpCapabilities(room.router);

      this.send(ws, {
        type: "room-joined",
        data: {
          roomId,
          rtpCapabilities
        }
      });
    } catch (error: any) {
      this.sendError(ws, error.message || "Failed to join room");
    }
  }

  /**
   * Handle leave room
   */
  private async handleLeaveRoom(_connectionId: string, userId: string, data: any) {
    const { roomId } = data;
    if (!roomId) {
      this.logger.warn(`[LeaveRoom] Missing roomId in request from user ${userId}`);
      return;
    }

    this.logger.log(`[LeaveRoom] User ${userId} leaving room ${roomId}`);

    // Try to remove as participant first, then as viewer
    // We need to check database regardless of in-memory state
    let removed = false;

    try {
      await this.roomService.removeParticipant(roomId, userId);
      this.logger.log(`[LeaveRoom] User ${userId} removed as participant from room ${roomId}`);
      removed = true;
    } catch (error: any) {
      this.logger.debug(`[LeaveRoom] removeParticipant failed for user ${userId}: ${error.message}`);

      // If room doesn't exist in memory, try database cleanup directly
      if (error.message?.includes("not found") || error.message?.includes("does not exist")) {
        this.logger.warn(`[LeaveRoom] Room ${roomId} not in memory, attempting database cleanup for user ${userId}`);
        try {
          await this.roomService.removeParticipantFromDatabase(roomId, userId);
          removed = true;
        } catch (dbError: any) {
          this.logger.debug(`[LeaveRoom] Database cleanup failed: ${dbError.message}`);
        }
      }
    }

    // If not removed as participant, try as viewer
    if (!removed) {
      try {
        await this.roomService.removeViewer(roomId, userId);
        this.logger.log(`[LeaveRoom] User ${userId} removed as viewer from room ${roomId}`);
        removed = true;
      } catch (viewerError: any) {
        if (!removed) {
          this.logger.error(`[LeaveRoom] Failed to remove user ${userId} from room ${roomId} as participant or viewer: ${viewerError.message}`);
        }
      }
    }
  }

  /**
   * Handle kick user (HOST only)
   */
  private async handleKickUser(
    _connectionId: string,
    userId: string,
    data: any,
    ws: any
  ) {
    const { roomId, targetUserId } = data;
    if (!roomId || !targetUserId) {
      this.sendError(ws, "roomId and targetUserId are required");
      return;
    }

    try {
      await this.roomService.kickUser(roomId, userId, targetUserId);

      // Notify the kicked user (if they're connected)
      for (const [, conn] of this.connections.entries()) {
        if (conn.userId === targetUserId) {
          this.send(conn.ws, {
            type: "user-kicked",
            data: {
              roomId,
              kickedBy: userId
            }
          });
          break;
        }
      }

      // Notify all participants about the kick
      await this.broadcastToRoom(roomId, {
        type: "participant-kicked",
        data: {
          roomId,
          kickedUserId: targetUserId,
          kickedBy: userId
        }
      }, userId); // Exclude the kicker from broadcast

      this.send(ws, {
        type: "user-kicked-success",
        data: {
          roomId,
          targetUserId
        }
      });
    } catch (error: any) {
      this.sendError(ws, error.message || "Failed to kick user");
    }
  }

  /**
   * Handle create transport
   */
  private async handleCreateTransport(
    _connectionId: string,
    userId: string,
    data: any,
    ws: any
  ) {
    const { roomId, producing, consuming } = data;
    if (!roomId) {
      throw new Error("roomId is required");
    }

    // Validate user is a participant in the room
    try {
      const isParticipant = await this.roomService.isParticipant(roomId, userId);
      if (!isParticipant) {
        throw new Error(`User ${userId} is not a participant in room ${roomId}`);
      }
    } catch (error: any) {
      // If room doesn't exist or other error, let it bubble up
      if (error.message?.includes("not found")) {
        throw new Error(`Room ${roomId} not found`);
      }
      throw error;
    }

    const transport = await this.callService.createTransport(
      roomId,
      userId,
      { producing, consuming }
    );

    this.send(ws, {
      type: "transport-created",
      data: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
        producing: !!producing
      }
    });
  }

  /**
   * Handle connect transport
   */
  private async handleConnectTransport(
    _connectionId: string,
    userId: string,
    data: any
  ) {
    const { roomId, transportId, dtlsParameters } = data;
    if (!roomId || !transportId || !dtlsParameters) {
      throw new Error("roomId, transportId, and dtlsParameters are required");
    }

    await this.callService.connectTransport(roomId, userId, transportId, dtlsParameters);
  }

  /**
   * Handle produce (send audio/video)
   */
  private async handleProduce(
    _connectionId: string,
    userId: string,
    data: any,
    ws: any
  ) {
    const { roomId, transportId, kind, rtpParameters } = data;
    if (!roomId || !transportId || !kind || !rtpParameters) {
      throw new Error("roomId, transportId, kind, and rtpParameters are required");
    }

    // Validate user is a participant (only participants can produce)
    const isParticipant = await this.roomService.isParticipant(roomId, userId);
    if (!isParticipant) {
      throw new Error(`User ${userId} is not a participant in room ${roomId}. Only participants can produce media.`);
    }

    const producer = await this.callService.produce(
      roomId,
      userId,
      transportId,
      kind,
      rtpParameters
    );

    this.send(ws, {
      type: "produced",
      data: {
        id: producer.id,
        kind: producer.kind
      }
    });

    // Notify other participants about new producer
    await this.notifyNewProducer(roomId, userId, producer.id, producer.kind);
  }

  /**
   * Handle consume (receive audio/video)
   */
  private async handleConsume(
    _connectionId: string,
    userId: string,
    data: any,
    ws: any
  ) {
    const { roomId, transportId, producerId, rtpCapabilities } = data;
    if (!roomId || !transportId || !producerId || !rtpCapabilities) {
      throw new Error("roomId, transportId, producerId, and rtpCapabilities are required");
    }

    const consumer = await this.callService.consume(
      roomId,
      userId,
      transportId,
      producerId,
      rtpCapabilities
    );

    // Find the producer's userId by looking through all participants
    let producerUserId: string | undefined;
    try {
      const room = this.roomService.getRoom(roomId);
      // Fixed: iterate over Map entries correctly
      for (const [pUserId, participant] of room.participants.entries()) {
        // Skip searching in own producers
        if (pUserId === userId) continue;

        // Fixed: Check producer object structure correctly
        const producer = (participant as any).producer;
        if (producer.audio?.id === producerId || producer.video?.id === producerId) {
          producerUserId = pUserId;
          break;
        }
      }
    } catch (error) {
      this.logger.warn(`Could not find producer userId for ${producerId}`);
    }

    this.send(ws, {
      type: "consumed",
      data: {
        id: consumer.id,
        producerId: consumer.producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        userId: producerUserId // Add the producer's userId
      }
    });
  }

  /**
   * Handle get-producers (returns list of existing producers in room)
   */
  private async handleGetProducers(
    _connectionId: string,
    userId: string,
    data: any,
    ws: any
  ) {
    const { roomId } = data;
    if (!roomId) {
      this.sendError(ws, "roomId is required");
      return;
    }

    try {
      // Get all producers except own
      const producers = await this.callService.getProducers(roomId, userId);

      this.send(ws, {
        type: "producers-list",
        data: producers
      });
    } catch (error: any) {
      this.logger.error(`Error in handleGetProducers: ${error.message}`);
      this.sendError(ws, error.message || "Failed to get producers");
    }
  }

  /**
   * Handle start broadcast
   */
  private async handleStartBroadcast(
    _connectionId: string,
    userId: string,
    data: any,
    ws: any
  ) {
    const { roomId } = data;
    if (!roomId) {
      this.sendError(ws, "roomId is required");
      return;
    }

    try {
      await this.broadcastService.startBroadcast(roomId, userId);

      // Send confirmation back to client
      this.send(ws, {
        type: "broadcast-started",
        data: {
          roomId
        }
      });

      // Notify all participants
      await this.broadcastToRoom(roomId, {
        type: "broadcast-started",
        data: { roomId }
      });
    } catch (error: any) {
      this.sendError(ws, error.message || "Failed to start broadcast");
    }
  }

  /**
   * Handle stop broadcast (HOST only)
   */
  private async handleStopBroadcast(
    _connectionId: string,
    userId: string,
    data: any,
    ws: any
  ) {
    const { roomId } = data;
    if (!roomId) {
      this.sendError(ws, "roomId is required");
      return;
    }

    try {
      await this.broadcastService.stopBroadcast(roomId, userId);

      // Send confirmation back to client
      this.send(ws, {
        type: "broadcast-stopped",
        data: {
          roomId
        }
      });

      // Notify all participants
      await this.broadcastToRoom(roomId, {
        type: "broadcast-stopped",
        data: { roomId, stoppedBy: userId }
      });
    } catch (error: any) {
      this.sendError(ws, error.message || "Failed to stop broadcast");
    }
  }

  /**
   * Handle join as viewer
   */
  private async handleJoinAsViewer(
    connectionId: string,
    userId: string,
    data: any,
    ws: any
  ) {
    const { roomId } = data;
    if (!roomId) {
      this.sendError(ws, "roomId is required");
      return;
    }

    let room;
    try {
      // Check if room exists first (checks both memory and database)
      const roomExists = await this.roomService.roomExists(roomId);
      if (!roomExists) {
        this.sendError(ws, `Room ${roomId} not found`);
        return;
      }

      // Check if user is already a participant (participants cannot join as viewers)
      // Check both in-memory map and database
      const participant = this.roomService.getParticipant(roomId, userId);
      if (participant) {
        this.logger.log(`[JoinAsViewer] User ${userId} is participant in memory map for room ${roomId}`);
        this.sendError(ws, "Participants cannot join as viewers");
        return;
      }

      // Also check database to ensure we catch participants who haven't created transports yet
      const isParticipant = await this.roomService.isParticipant(roomId, userId);
      this.logger.log(`[JoinAsViewer] User ${userId} isParticipant check for room ${roomId}: ${isParticipant}`);
      if (isParticipant) {
        this.logger.log(`[JoinAsViewer] User ${userId} is participant in database for room ${roomId}, rejecting viewer join`);
        this.sendError(ws, "Participants cannot join as viewers");
        return;
      }

      // Check if room is broadcasting
      room = this.roomService.getRoom(roomId);
      if (!room.isBroadcasting) {
        this.sendError(ws, "Room is not broadcasting");
        return;
      }
    } catch (error: any) {
      // Handle room not found or other errors
      if (error.message?.includes("not found")) {
        this.sendError(ws, `Room ${roomId} not found`);
      } else {
        this.sendError(ws, error.message || "Failed to validate viewer join");
      }
      return;
    }

    const conn = this.connections.get(connectionId);
    if (conn) {
      conn.roomId = roomId;
    }

    try {
      await this.broadcastService.addViewer(roomId, userId);

      // Get router RTP capabilities
      const rtpCapabilities = this.mediasoup.getRtpCapabilities(room.router);

      this.send(ws, {
        type: "viewer-joined",
        data: {
          roomId,
          rtpCapabilities
        }
      });
    } catch (error: any) {
      this.sendError(ws, error.message || "Failed to join as viewer");
    }
  }

  /**
   * Handle chat message
   */
  /**
   * Handle dare view (real-time synchronization)
   */
  private async handleDareView(
    _connectionId: string,
    userId: string,
    data: any,
    ws: any
  ) {
    const { roomId, dareId } = data;
    if (!roomId || !dareId) {
      this.sendError(ws, "roomId and dareId are required");
      return;
    }

    try {
      await this.dareService.viewDare(roomId, userId, dareId);

      // Broadcast to all participants in the room (real-time sync)
      await this.broadcastToRoom(roomId, {
        type: "dare-viewing",
        data: {
          roomId,
          dareId,
          viewedBy: userId
        }
      }, userId);

      this.send(ws, {
        type: "dare-viewed",
        data: { roomId, dareId }
      });
    } catch (error: any) {
      this.sendError(ws, error.message || "Failed to view dare");
    }
  }

  /**
   * Handle dare assign
   */
  private async handleDareAssign(
    _connectionId: string,
    userId: string,
    data: any,
    ws: any
  ) {
    const { roomId, dareId, assignedToUserId } = data;
    if (!roomId || !dareId || !assignedToUserId) {
      this.sendError(ws, "roomId, dareId, and assignedToUserId are required");
      return;
    }

    try {
      await this.dareService.assignDare(roomId, userId, assignedToUserId, dareId);

      // Notify all participants
      await this.broadcastToRoom(roomId, {
        type: "dare-assigned",
        data: {
          roomId,
          dareId,
          assignedBy: userId,
          assignedTo: assignedToUserId
        }
      }, userId);

      this.send(ws, {
        type: "dare-assigned-success",
        data: { roomId, dareId, assignedTo: assignedToUserId }
      });
    } catch (error: any) {
      this.sendError(ws, error.message || "Failed to assign dare");
    }
  }

  /**
   * Handle dare send with gift (50% payment)
   */
  private async handleDareSend(
    _connectionId: string,
    userId: string,
    data: any,
    ws: any
  ) {
    const { roomId, dareId, giftId } = data;
    if (!roomId || !dareId || !giftId) {
      this.sendError(ws, "roomId, dareId, and giftId are required");
      return;
    }

    try {
      const result = await this.dareService.sendDare(roomId, userId, dareId, giftId);

      // If auto-assigned (2-user call), broadcast assignment event first
      if (result.wasAutoAssigned && result.assignedTo) {
        await this.broadcastToRoom(roomId, {
          type: "dare-assigned",
          data: {
            roomId,
            dareId,
            assignedBy: userId,
            assignedTo: result.assignedTo
          }
        }, userId);
      }

      // Broadcast to all participants
      await this.broadcastToRoom(roomId, {
        type: "dare-sent",
        data: {
          roomId,
          dareId,
          giftId,
          sentBy: userId,
          assignedTo: result.assignedTo
        }
      }, userId);

      this.send(ws, {
        type: "dare-sent-success",
        data: {
          roomId,
          dareId,
          giftId,
          transactionId: result.transactionId,
          newBalance: result.newBalance,
          assignedTo: result.assignedTo,
          wasAutoAssigned: result.wasAutoAssigned
        }
      });
    } catch (error: any) {
      this.sendError(ws, error.message || "Failed to send dare");
    }
  }

  /**
   * Handle get icebreaker (returns random icebreaker and broadcasts to all participants)
   */
  private async handleGetIcebreaker(
    _connectionId: string,
    userId: string,
    data: any,
    ws: any
  ) {
    const { roomId } = data;
    if (!roomId) {
      this.sendError(ws, "roomId is required");
      return;
    }

    try {
      // Verify user is in the room
      const isParticipant = await this.roomService.isParticipant(roomId, userId);
      if (!isParticipant) {
        this.sendError(ws, `User ${userId} is not a participant in room ${roomId}`);
        return;
      }

      // Get random icebreaker (now async)
      const icebreaker = await this.icebreakerService.getRandomIcebreaker();

      // Broadcast to all participants in the room (so everyone sees the same icebreaker)
      await this.broadcastToRoom(roomId, {
        type: "icebreaker",
        data: {
          roomId,
          question: icebreaker,
          requestedBy: userId
        }
      });

      // Send success confirmation to requester
      this.send(ws, {
        type: "icebreaker-success",
        data: {
          roomId,
          question: icebreaker
        }
      });

      this.logger.log(`User ${userId} requested icebreaker in room ${roomId}: ${icebreaker} (broadcasted to all)`);
    } catch (error: any) {
      this.sendError(ws, error.message || "Failed to get icebreaker");
    }
  }

  /**
   * Handle send friend request (during call)
   * User clicks "+" button on participant's video/audio placeholder
   */
  private async handleSendFriendRequest(
    _connectionId: string,
    userId: string,
    data: any,
    ws: any
  ) {
    const { roomId, toUserId } = data;
    if (!roomId || !toUserId) {
      this.sendError(ws, "roomId and toUserId are required");
      return;
    }

    try {
      // Verify user is in the room
      const isParticipant = await this.roomService.isParticipant(roomId, userId);
      if (!isParticipant) {
        this.sendError(ws, `User ${userId} is not a participant in room ${roomId}`);
        return;
      }

      // Verify target user is also in the room
      const isTargetParticipant = await this.roomService.isParticipant(roomId, toUserId);
      if (!isTargetParticipant) {
        this.sendError(ws, `Target user ${toUserId} is not a participant in room ${roomId}`);
        return;
      }

      // Send friend request via friend-service
      const result = await this.friendClient.sendFriendRequestDuringCall(
        userId,
        toUserId,
        roomId
      );

      // Send confirmation to requester only
      this.send(ws, {
        type: "friend-request-sent",
        data: {
          roomId,
          toUserId,
          requestId: result.requestId,
          autoAccepted: result.autoAccepted
        }
      });

      // If auto-accepted (mutual request), notify both users
      if (result.autoAccepted) {
        // Notify requester
        this.send(ws, {
          type: "friend-request-accepted",
          data: {
            roomId,
            friendId: toUserId,
            mutual: true
          }
        });

        // Notify target user (if connected) - only for mutual requests
        await this.broadcastToRoom(roomId, {
          type: "friend-request-accepted",
          data: {
            roomId,
            friendId: userId,
            mutual: true
          }
        }, userId);
      }
      // NOTE: No notification sent to target user for pending requests
      // User B will see the request in their "Pending Requests" tab when they check

      this.logger.log(
        `Friend request sent from ${userId} to ${toUserId} in room ${roomId} ` +
        `(autoAccepted: ${result.autoAccepted})`
      );
    } catch (error: any) {
      this.logger.error(`Error sending friend request: ${error.message}`);
      this.sendError(ws, error.message || "Failed to send friend request");
    }
  }

  private async handleChatMessage(
    _connectionId: string,
    userId: string,
    data: any,
    ws: any
  ) {
    const { roomId, message } = data;
    if (!roomId || !message) {
      this.sendError(ws, "roomId and message are required");
      return;
    }

    // Check if room exists first (checks both memory and database)
    const roomExists = await this.roomService.roomExists(roomId);
    if (!roomExists) {
      this.sendError(ws, `Room ${roomId} not found`);
      return;
    }

    // Validate message before sending
    if (!message.trim() || message.trim().length === 0) {
      this.sendError(ws, "Message cannot be empty");
      return;
    }

    if (message.length > 1000) {
      this.sendError(ws, "Message too long (max 1000 characters)");
      return;
    }

    try {
      const chatMessage = await this.chatService.sendMessage(roomId, userId, message);

      // Send confirmation back to client
      this.send(ws, {
        type: "chat-message",
        data: {
          id: chatMessage.id,
          roomId: chatMessage.roomId,
          userId: chatMessage.userId,
          message: chatMessage.message,
          createdAt: chatMessage.createdAt
        }
      });

      // Broadcast message to all participants and viewers
      await this.broadcastToRoom(roomId, {
        type: "chat-message",
        data: {
          userId,
          message: chatMessage.message,
          createdAt: chatMessage.createdAt
        }
      }, userId);
    } catch (error: any) {
      // Handle errors from chat service (e.g., room not found, validation errors)
      this.sendError(ws, error.message || "Failed to send chat message");
    }
  }

  /**
   * Handle disconnection
   * Removes user from room (as participant or viewer) even if room not in memory
   */
  private async handleDisconnection(
    connectionId: string,
    userId: string,
    roomId: string | null
  ) {
    let resolvedRoomId = roomId;
    if (!resolvedRoomId && !this.isAnonymousUser(userId)) {
      const viewerRoom = await this.roomService.getUserActiveRoomAsViewer(userId);
      if (viewerRoom) {
        resolvedRoomId = viewerRoom.roomId;
      } else {
        const participantRoom = await this.roomService.getUserActiveRoom(userId);
        if (participantRoom) {
          resolvedRoomId = participantRoom.roomId;
        }
      }
    }

    if (!resolvedRoomId) {
      this.logger.log(`WebSocket connection closed: ${connectionId} (user: ${userId}, no room)`);
      return;
    }

    this.logger.log(`WebSocket connection closed: ${connectionId} (user: ${userId}, room: ${resolvedRoomId})`);

    // Check if room exists (in memory or database) before trying to remove user
    const roomExists = await this.roomService.roomExists(resolvedRoomId);
    if (!roomExists) {
      this.logger.debug(`[Disconnect] Room ${resolvedRoomId} does not exist, skipping removal for user ${userId}`);
      return;
    }

    // Try to remove as viewer first (viewers are less critical)
    let removed = false;
    try {
      await this.roomService.removeViewer(resolvedRoomId, userId);
      this.logger.log(`[Disconnect] User ${userId} removed as viewer from room ${resolvedRoomId}`);
      removed = true;
    } catch (error: any) {
      // Not a viewer, or already removed, continue to check participant
      this.logger.debug(`[Disconnect] User ${userId} not a viewer in room ${resolvedRoomId}: ${error.message}`);
    }

    // Try to remove as participant if not removed as viewer
    if (!removed) {
      try {
        await this.roomService.removeParticipant(resolvedRoomId, userId);
        this.logger.log(`[Disconnect] User ${userId} removed as participant from room ${resolvedRoomId}`);
      } catch (error: any) {
        // User might not be in room, or room might be already ended
        if (error.message?.includes("not found") || error.message?.includes("does not exist")) {
          this.logger.debug(`[Disconnect] Room ${resolvedRoomId} not found or user ${userId} not in room`);
        } else {
          this.logger.warn(`[Disconnect] Failed to remove user ${userId} from room ${resolvedRoomId}: ${error.message}`);
        }
      }
    }
  }

  /**
   * Notify room about new producer
   */
  private async notifyNewProducer(
    roomId: string,
    userId: string,
    producerId: string,
    kind: string
  ) {
    await this.broadcastToRoom(roomId, {
      type: "new-producer",
      data: {
        userId,
        producerId,
        kind
      }
    }, userId); // Exclude the producer
  }

  /**
   * Broadcast message to all connections in a room
   */
  private async broadcastToRoom(
    roomId: string,
    message: any,
    excludeUserId?: string
  ) {
    for (const [connId, conn] of this.connections.entries()) {
      if (conn.roomId === roomId && conn.userId !== excludeUserId) {
        try {
          this.send(conn.ws, message);
        } catch (error) {
          this.logger.error(`Error broadcasting to ${connId}:`, error);
        }
      }
    }
  }

  /**
   * Send message to WebSocket connection
   */
  private send(connection: any, message: any) {
    if (connection.readyState === 1) { // WebSocket.OPEN
      connection.send(JSON.stringify(message));
    }
  }

  /**
   * Send error message
   */
  private sendError(ws: any, error: string) {
    this.send(ws, {
      type: "error",
      data: { error }
    });
  }

  /**
   * Extract JWT token from request
   */
  private extractToken(req: any): string | null {
    // 1. Try Authorization header (server-to-server or non-browser clients)
    const authHeader = req.headers?.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      return authHeader.substring(7);
    }

    // 2. Browsers cannot send custom headers on WebSocket upgrade requests,
    //    so we also accept ?token=<jwt> as a query parameter.
    const url = req?.url || '';
    if (url.includes('?')) {
      try {
        const queryString = url.split('?')[1];
        const params = new URLSearchParams(queryString);
        const tokenParam = params.get('token');
        if (tokenParam) return tokenParam;
      } catch (e) {
        const match = url.match(/[?&]token=([^&]*)/);
        if (match) return decodeURIComponent(match[1]);
      }
    }

    return null;
  }

  /**
   * Extract deviceId from WebSocket connection URL query params
   */
  private extractDeviceId(req: any): string | null {
    const url = req?.url || '';
    if (url.includes('?')) {
      try {
        const queryString = url.split('?')[1];
        const params = new URLSearchParams(queryString);
        return params.get("deviceId");
      } catch (e) {
        // If URL parsing fails, try manual regex parsing
        const match = url.match(/[?&]deviceId=([^&]*)/);
        return match ? decodeURIComponent(match[1]) : null;
      }
    }
    return null;
  }

  /**
   * Generate unique connection ID
   */
  private generateConnectionId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Handle create viewer transport (for TikTok-style viewing)
   */
  private async handleCreateViewerTransport(
    _connectionId: string,
    userId: string,
    data: any,
    ws: any
  ) {
    const { roomId } = data;
    if (!roomId) {
      this.sendError(ws, "roomId is required");
      return;
    }

    try {
      const transport = await this.broadcastService.createViewerTransport(roomId, userId);

      this.send(ws, {
        type: "viewer-transport-created",
        data: {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters
        }
      });
    } catch (error: any) {
      this.sendError(ws, error.message || "Failed to create viewer transport");
    }
  }

  /**
   * Handle connect viewer transport
   */
  private async handleConnectViewerTransport(
    _connectionId: string,
    userId: string,
    data: any
  ) {
    const { roomId, transportId, dtlsParameters } = data;
    if (!roomId || !transportId || !dtlsParameters) {
      throw new Error("roomId, transportId, and dtlsParameters are required");
    }

    await this.broadcastService.connectViewerTransport(roomId, userId, transportId, dtlsParameters);
  }

  /**
   * Handle get broadcast producers
   */
  private async handleGetBroadcastProducers(
    _connectionId: string,
    _userId: string,
    data: any,
    ws: any
  ) {
    const { roomId } = data;
    if (!roomId) {
      this.sendError(ws, "roomId is required");
      return;
    }

    try {
      const producers = await this.broadcastService.getBroadcastProducers(roomId);

      this.send(ws, {
        type: "broadcast-producers",
        data: {
          roomId,
          producers
        }
      });
    } catch (error: any) {
      this.sendError(ws, error.message || "Failed to get broadcast producers");
    }
  }

  /**
   * Handle consume broadcast stream
   */
  private async handleConsumeBroadcast(
    _connectionId: string,
    userId: string,
    data: any,
    ws: any
  ) {
    const { roomId, transportId, producerId, rtpCapabilities } = data;
    if (!roomId || !transportId || !producerId || !rtpCapabilities) {
      this.sendError(ws, "roomId, transportId, producerId, and rtpCapabilities are required");
      return;
    }

    try {
      const consumer = await this.broadcastService.consumeBroadcast(
        roomId,
        userId,
        transportId,
        producerId,
        rtpCapabilities
      );

      this.send(ws, {
        type: "broadcast-consumed",
        data: {
          id: consumer.id,
          producerId: consumer.producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters
        }
      });
    } catch (error: any) {
      this.sendError(ws, error.message || "Failed to consume broadcast");
    }
  }

  async onModuleDestroy() {
    if (this.wss) {
      this.wss.close();
    }
  }
}
