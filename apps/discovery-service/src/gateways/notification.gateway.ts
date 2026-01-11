import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy
} from "@nestjs/common";
import { WebSocketServer } from "ws";
import { verifyToken, AccessPayload } from "@hmm/common";
import { JWK } from "jose";

interface NotificationMessage {
  type: string;
  data?: any;
}

@Injectable()
export class NotificationGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationGateway.name);
  private wss: WebSocketServer | null = null; // Stored for cleanup in onModuleDestroy
  private verifyAccess!: (token: string) => Promise<AccessPayload>;
  private publicJwk!: JWK;
  private connections = new Map<string, { ws: any; userId: string }>();
  private readonly testMode: boolean;

  constructor() {
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
        return { sub: token || "test-user" } as AccessPayload;
      };
    }
  }

  async onModuleDestroy() {
    // Cleanup connections
    for (const [connectionId, conn] of this.connections) {
      try {
        conn.ws.close();
      } catch (error) {
        this.logger.error(`Error closing connection ${connectionId}:`, error);
      }
    }
    this.connections.clear();
    
    // Close WebSocket server if it exists
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
  }

  /**
   * Initialize WebSocket server with ws package
   */
  initialize(wss: WebSocketServer) {
    this.wss = wss; // Store for potential future use
    wss.on("connection", (ws: any, req: any) => {
      // Check if this is the correct path
      const url = req.url || '';
      if (!url.includes('/notifications/ws')) {
        this.logger.warn(`WebSocket connection to wrong path: ${url}`);
        ws.close(1008, 'Invalid path');
        return;
      }
      
      this.logger.debug(`WebSocket connection - url: ${url}`);
      this.handleConnection(ws, req);
    });

    this.logger.log("Notification WebSocket gateway initialized at /notifications/ws");
  }

  /**
   * Handle new WebSocket connection
   */
  private async handleConnection(ws: any, req: any) {
    const connectionId = this.generateConnectionId();
    let userId: string | null = null;

    // Authenticate connection
    try {
      if (this.testMode) {
        // In test mode, get userId from query param
        const urlString = req?.url || '';
        if (urlString && urlString.includes('?')) {
          try {
            const queryString = urlString.split('?')[1];
            const params = new URLSearchParams(queryString);
            userId = params.get("userId") || "test-user-1";
          } catch (e) {
            const match = urlString.match(/[?&]userId=([^&]*)/);
            userId = match ? decodeURIComponent(match[1]) : "test-user-1";
          }
        } else {
          userId = "test-user-1";
        }
        this.logger.log(`[TEST MODE] WebSocket connection with userId: ${userId}`);
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

    this.logger.log(`Notification WebSocket connection established: ${connectionId} (user: ${userId})`);

    // Handle disconnection
    ws.on("close", () => {
      this.handleDisconnection(connectionId, userId!);
      this.connections.delete(connectionId);
    });

    // Handle errors
    ws.on("error", (error: Error) => {
      this.logger.error(`WebSocket error for ${connectionId}:`, error);
    });

    // Send connection confirmation
    this.sendMessage(ws, {
      type: "connected",
      data: { connectionId, userId }
    });
  }

  /**
   * Send notification to user
   */
  async sendNotification(userId: string, message: NotificationMessage): Promise<void> {
    // Find all connections for this user
    const userConnections = Array.from(this.connections.entries()).filter(
      ([_, conn]) => conn.userId === userId
    );

    if (userConnections.length === 0) {
      this.logger.debug(`No active WebSocket connections for user ${userId}`);
      // User is offline or not connected - notification will be missed
      // Could implement polling endpoint as fallback
      return;
    }

    // Send to all connections for this user
    for (const [connectionId, conn] of userConnections) {
      try {
        if (conn.ws.readyState === 1) { // WebSocket.OPEN
          this.sendMessage(conn.ws, message);
          this.logger.debug(`Notification sent to ${userId} via connection ${connectionId}`);
        } else {
          // Connection is not open, remove it
          this.connections.delete(connectionId);
        }
      } catch (error) {
        this.logger.error(`Error sending notification to ${userId} via ${connectionId}:`, error);
        // Remove broken connection
        this.connections.delete(connectionId);
      }
    }
  }

  /**
   * Handle disconnection
   */
  private handleDisconnection(connectionId: string, userId: string) {
    this.logger.log(`Notification WebSocket connection closed: ${connectionId} (user: ${userId})`);
  }

  /**
   * Send message to WebSocket
   */
  private sendMessage(ws: any, message: NotificationMessage) {
    try {
      if (ws.readyState === 1) { // WebSocket.OPEN
        ws.send(JSON.stringify(message));
      }
    } catch (error) {
      this.logger.error("Error sending WebSocket message:", error);
    }
  }

  /**
   * Send error message to WebSocket
   */
  private sendError(ws: any, message: string) {
    this.sendMessage(ws, {
      type: "error",
      data: { message }
    });
  }

  /**
   * Extract token from request
   */
  private extractToken(req: any): string | null {
    // Try Authorization header
    const authHeader = req.headers?.authorization || req.headers?.Authorization;
    if (authHeader) {
      const [type, token] = authHeader.split(" ");
      if (type?.toLowerCase() === "bearer") {
        return token;
      }
    }

    // Try query parameter
    const url = req.url || '';
    if (url.includes('token=')) {
      const match = url.match(/[?&]token=([^&]*)/);
      if (match) {
        return decodeURIComponent(match[1]);
      }
    }

    return null;
  }

  /**
   * Generate unique connection ID
   */
  private generateConnectionId(): string {
    return `conn_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}
