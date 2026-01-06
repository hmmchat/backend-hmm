import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

export interface ChatMessage {
  id: string;
  roomId: string;
  userId: string;
  message: string;
  createdAt: Date;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly messageHistory: Map<string, ChatMessage[]> = new Map(); // roomId -> messages

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Send a chat message
   */
  async sendMessage(roomId: string, userId: string, message: string): Promise<ChatMessage> {
    if (!message || message.trim().length === 0) {
      throw new Error("Message cannot be empty");
    }

    if (message.length > 1000) {
      throw new Error("Message too long (max 1000 characters)");
    }

    // Verify room exists
    const room = await this.prisma.callSession.findUnique({
      where: { roomId },
    });

    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    // Record as a call message
    const messageRecord = await this.prisma.callMessage.create({
      data: {
        sessionId: room.id,
        userId,
        message: message.trim(),
      },
    });

    const chatMessage: ChatMessage = {
      id: messageRecord.id,
      roomId,
      userId,
      message: messageRecord.message,
      createdAt: messageRecord.createdAt,
    };

    // Store in memory for quick access
    if (!this.messageHistory.has(roomId)) {
      this.messageHistory.set(roomId, []);
    }
    this.messageHistory.get(roomId)!.push(chatMessage);

    // Keep only last 100 messages in memory
    const messages = this.messageHistory.get(roomId)!;
    if (messages.length > 100) {
      messages.shift();
    }

    this.logger.log(`Chat message sent by ${userId} in room ${roomId}`);

    return chatMessage;
  }

  /**
   * Get chat message history for a room
   */
  async getMessageHistory(roomId: string, limit: number = 50): Promise<ChatMessage[]> {
    return this.getChatHistory(roomId, limit);
  }

  /**
   * Get chat history for a room
   */
  async getChatHistory(roomId: string, limit: number = 50): Promise<ChatMessage[]> {
    const room = await this.prisma.callSession.findUnique({
      where: { roomId },
    });

    if (!room) {
      return []; // Return empty array instead of throwing error
    }

    // Try to get from memory first
    const cachedMessages = this.messageHistory.get(roomId);
    if (cachedMessages && cachedMessages.length >= limit) {
      return cachedMessages.slice(-limit);
    }

    // Otherwise, fetch from database
    const messageRecords = await this.prisma.callMessage.findMany({
      where: {
        sessionId: room.id,
      },
      orderBy: {
        createdAt: "asc",
      },
      take: limit,
    });

    const messages: ChatMessage[] = messageRecords.map((msg) => ({
      id: msg.id,
      roomId,
      userId: msg.userId,
      message: msg.message,
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
