import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

export interface ChatMessage {
  id: string;
  roomId: string;
  userId: string;
  message: string | null;
  messageType: "TEXT" | "GIF" | "GIF_WITH_MESSAGE";
  gif: {
    provider: "giphy";
    id: string;
    url: string;
    previewUrl?: string;
    width?: number;
    height?: number;
  } | null;
  createdAt: Date;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly messageHistory: Map<string, ChatMessage[]> = new Map(); // roomId -> messages
  private readonly maxMessageLength: number;
  private readonly historyMemoryLimit: number;
  private readonly historyDefaultLimit: number;

  constructor(private readonly prisma: PrismaService) {
    this.maxMessageLength = parseInt(process.env.CHAT_MAX_MESSAGE_LENGTH || "1000", 10);
    this.historyMemoryLimit = parseInt(process.env.CHAT_HISTORY_MEMORY_LIMIT || "100", 10);
    this.historyDefaultLimit = parseInt(process.env.CHAT_HISTORY_DEFAULT_LIMIT || "50", 10);
  }

  /**
   * Send a chat message
   */
  async sendMessage(
    roomId: string,
    userId: string,
    payload: {
      message?: string;
      gif?: {
        provider: "giphy";
        id: string;
        url: string;
        previewUrl?: string;
        width?: number;
        height?: number;
      };
    }
  ): Promise<ChatMessage> {
    const rawMessage = payload.message ?? "";
    const message = rawMessage.trim();
    const gif = payload.gif;

    const hasText = message.length > 0;
    const hasGif = !!gif;
    if (!hasText && !hasGif) {
      throw new Error("Message cannot be empty");
    }

    if (hasText && message.length > this.maxMessageLength) {
      throw new Error(`Message too long (max ${this.maxMessageLength} characters)`);
    }

    // Verify room exists
    const room = await this.prisma.callSession.findUnique({
      where: { roomId },
    });

    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    const messageType: "TEXT" | "GIF" | "GIF_WITH_MESSAGE" =
      hasGif && hasText ? "GIF_WITH_MESSAGE" : hasGif ? "GIF" : "TEXT";

    // Record as a call message
    const messageRecord = (await this.prisma.callMessage.create({
      data: {
        sessionId: room.id,
        userId,
        // Keep schema/backward-compat during prisma client regen: older schema expects non-null string.
        message: hasText ? message : "",
        messageType,
        gifProvider: gif?.provider || null,
        gifId: gif?.id || null,
        gifUrl: gif?.url || null,
        gifPreviewUrl: gif?.previewUrl || null,
        gifWidth: gif?.width ?? null,
        gifHeight: gif?.height ?? null
      } as any
    })) as any;

    const chatMessage: ChatMessage = {
      id: messageRecord.id,
      roomId,
      userId,
      message: hasText ? messageRecord.message : null,
      messageType: (messageRecord.messageType ?? messageType) as any,
      gif: messageRecord.gifId
        ? {
            provider: messageRecord.gifProvider as any,
            id: messageRecord.gifId,
            url: messageRecord.gifUrl as any,
            previewUrl: messageRecord.gifPreviewUrl ?? undefined,
            width: messageRecord.gifWidth ?? undefined,
            height: messageRecord.gifHeight ?? undefined
          }
        : null,
      createdAt: messageRecord.createdAt,
    };

    // Store in memory for quick access
    if (!this.messageHistory.has(roomId)) {
      this.messageHistory.set(roomId, []);
    }
    this.messageHistory.get(roomId)!.push(chatMessage);

    // Keep only last N messages in memory
    const messages = this.messageHistory.get(roomId)!;
    if (messages.length > this.historyMemoryLimit) {
      messages.shift();
    }

    this.logger.log(`Chat message sent by ${userId} in room ${roomId}`);

    return chatMessage;
  }

  /**
   * Get chat message history for a room
   */
  async getMessageHistory(roomId: string, limit?: number): Promise<ChatMessage[]> {
    return this.getChatHistory(roomId, limit ?? this.historyDefaultLimit);
  }

  /**
   * Get chat history for a room
   */
  async getChatHistory(roomId: string, limit?: number): Promise<ChatMessage[]> {
    const takeLimit = limit ?? this.historyDefaultLimit;
    const room = await this.prisma.callSession.findUnique({
      where: { roomId },
    });

    if (!room) {
      return []; // Return empty array instead of throwing error
    }

    // Try to get from memory first
    const cachedMessages = this.messageHistory.get(roomId);
    if (cachedMessages && cachedMessages.length >= takeLimit) {
      return cachedMessages.slice(-takeLimit);
    }

    // Otherwise, fetch from database
    const messageRecords = await this.prisma.callMessage.findMany({
      where: {
        sessionId: room.id,
      },
      orderBy: {
        createdAt: "asc",
      },
      take: takeLimit,
    });

    const messages: ChatMessage[] = messageRecords.map((msg) => ({
      id: msg.id,
      roomId,
      userId: msg.userId,
      message: msg.message ?? null,
      messageType: (msg as any).messageType ?? "TEXT",
      gif: (msg as any).gifId
        ? {
            provider: (msg as any).gifProvider,
            id: (msg as any).gifId,
            url: (msg as any).gifUrl,
            previewUrl: (msg as any).gifPreviewUrl ?? undefined,
            width: (msg as any).gifWidth ?? undefined,
            height: (msg as any).gifHeight ?? undefined
          }
        : null,
      createdAt: msg.createdAt,
    }));

    // Cache in memory
    this.messageHistory.set(roomId, messages);

    return messages;
  }

  /**
   * Clear message history for a room (when call ends)
   */
  clearMessageHistory(roomId: string): void {
    this.messageHistory.delete(roomId);
    this.logger.log(`Chat history cleared for room ${roomId}`);
  }
}
