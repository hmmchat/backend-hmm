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
  private connections = new Map<string, { ws: any; userId: string; roomId?: string }>();
  private readonly testMode: boolean;

  constructor(
    private roomService: RoomService,
    private mediasoup: MediasoupService,
    private callService: CallService,
    private broadcastService: BroadcastService,
    private chatService: ChatService
  ) {
    this.testMode = process.env.TEST_MODE === "true" || process.env.NODE_ENV === "test";
  }

  async onModuleInit() {
    // Initialize JWT verification only if not in test mode
    if (!this.testMode) {
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
    let roomId: string | null = null;

    // Authenticate connection
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
        if (!token) {
          this.sendError(ws, "Authentication required");
          ws.close();
          return;
        }

        const payload = await this.verifyAccess(token);
        userId = payload.sub;
      }
      
      this.connections.set(connectionId, { ws: ws, userId });
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

    // Handle disconnection
    ws.on("close", () => {
      this.handleDisconnection(connectionId, userId!, roomId);
      this.connections.delete(connectionId);
    });

    // Handle errors
    ws.on("error", (error: Error) => {
      this.logger.error(`WebSocket error for ${connectionId}:`, error);
    });
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
          await this.handleJoinRoom(connectionId, userId, data, ws);
          break;

        case "leave-room":
          await this.handleLeaveRoom(connectionId, userId, data);
          break;

        // Call signaling (for participants)
        case "create-transport":
          await this.handleCreateTransport(connectionId, userId, data, ws);
          break;

        case "connect-transport":
          await this.handleConnectTransport(connectionId, userId, data);
          break;

        case "produce":
          await this.handleProduce(connectionId, userId, data, ws);
          break;

        case "consume":
          await this.handleConsume(connectionId, userId, data, ws);
          break;

        // Broadcasting
        case "start-broadcast":
          await this.handleStartBroadcast(connectionId, userId, data, ws);
          break;

        case "join-as-viewer":
          await this.handleJoinAsViewer(connectionId, userId, data, ws);
          break;

        // Chat
        case "chat-message":
          await this.handleChatMessage(connectionId, userId, data, ws);
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
        dtlsParameters: transport.dtlsParameters
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

    this.send(ws, {
      type: "consumed",
      data: {
        id: consumer.id,
        producerId: consumer.producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters
      }
    });
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
      });
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
    if (!roomId) {
      this.logger.log(`WebSocket connection closed: ${connectionId} (user: ${userId}, no room)`);
      return;
    }

    this.logger.log(`WebSocket connection closed: ${connectionId} (user: ${userId}, room: ${roomId})`);

    // Check if room exists (in memory or database) before trying to remove user
    const roomExists = await this.roomService.roomExists(roomId);
    if (!roomExists) {
      this.logger.debug(`[Disconnect] Room ${roomId} does not exist, skipping removal for user ${userId}`);
      return;
    }

    // Try to remove as viewer first (viewers are less critical)
    let removed = false;
    try {
      await this.roomService.removeViewer(roomId, userId);
      this.logger.log(`[Disconnect] User ${userId} removed as viewer from room ${roomId}`);
      removed = true;
    } catch (error: any) {
      // Not a viewer, or already removed, continue to check participant
      this.logger.debug(`[Disconnect] User ${userId} not a viewer in room ${roomId}: ${error.message}`);
    }

    // Try to remove as participant if not removed as viewer
    if (!removed) {
      try {
        await this.roomService.removeParticipant(roomId, userId);
        this.logger.log(`[Disconnect] User ${userId} removed as participant from room ${roomId}`);
      } catch (error: any) {
        // User might not be in room, or room might be already ended
        if (error.message?.includes("not found") || error.message?.includes("does not exist")) {
          this.logger.debug(`[Disconnect] Room ${roomId} not found or user ${userId} not in room`);
        } else {
          this.logger.warn(`[Disconnect] Failed to remove user ${userId} from room ${roomId}: ${error.message}`);
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
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      return authHeader.substring(7);
    }
    return null;
  }

  /**
   * Generate unique connection ID
   */
  private generateConnectionId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  async onModuleDestroy() {
    if (this.wss) {
      this.wss.close();
    }
  }
}
